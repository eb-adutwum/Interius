import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/ThemeToggle';
import { supabase } from '../lib/supabase';
import { generateThreadTitle } from '../lib/llm';
import './ChatPage.css';

/* ─── Static Data ─── */
const FILE_OPTIONS = [
    { icon: '📄', label: 'routes.py' },
    { icon: '📄', label: 'models.py' },
    { icon: '📄', label: 'main.py' },
    { icon: '📁', label: 'Upload file…' },
];

const COMMAND_OPTIONS = [
    { cmd: '/summarize', desc: 'Summarize the current API' },
    { cmd: '/test', desc: 'Run all endpoint tests' },
    { cmd: '/deploy', desc: 'Deploy to cloud' },
    { cmd: '/document', desc: 'Generate API docs' },
];

const INITIAL_THREADS = [
    { id: 'b1', title: 'api-gateway' },
    { id: 'b2', title: 'auth-module' },
    { id: 'b3', title: 'task-service' },
    { id: 'b4', title: 'deploy-pipeline' },
];

const SUGGESTIONS = {
    pro: [
        { label: 'Build a FastAPI task manager with JWT auth, CRUD endpoints, and input validation' },
        { label: 'Containerize my API with Docker — multi-stage build, health check, and env vars' },
    ],
    generalist: [
        { label: 'Scaffold a Node.js microservice with rate limiting, logging, and OpenAPI docs' },
        { label: 'Create a CLI tool in Python that reads my codebase and generates a README' },
    ],
};

const AGENT_PHASE_1 = [
    {
        id: 'req',
        text: 'Analyzing requirements…',
        doneText: 'Requirement analysis done.',
        sub: [{ label: 'Requirements doc', action: 'file:Requirements Document' }]
    },
    {
        id: 'arch',
        text: 'Planning architecture…',
        doneText: 'Architecture designed.',
        sub: [{ label: 'Architecture diagram', action: 'link:https://app.diagrams.net/' }]
    }
];

const AGENT_PHASE_2 = [
    {
        id: 'code',
        text: 'Generating code…',
        doneText: 'Code generation complete.',
        sub: [
            { label: 'Schema models', action: 'file:app/models.py' },
            { label: 'API endpoints', action: 'file:app/routes.py' },
            { label: 'Unit tests', action: 'file:tests.py' }
        ]
    },
    {
        id: 'deploy',
        text: 'Containerizing application…',
        doneText: 'Deployed docker container.',
        icon: 'deploy',
        sub: [{ label: 'dockerhub', action: 'link:https://hub.docker.com/' }]
    }
];

const AGENT_FINAL = {
    text: "I've scaffolded a task management API with authentication, CRUD endpoints, and input validation.",
    showEndpoints: true,
    files: ['app/main.py', 'app/models.py', 'app/routes.py', 'Dockerfile'],
};

const MOCK_FILES = {
    'app/main.py': `from fastapi import FastAPI
from .routes import router

app = FastAPI(title="Task API")
app.include_router(router, prefix="/api")

@app.get("/health")
def health():
    return {"status": "ok"}`,
    'app/models.py': `from sqlalchemy import Column, Integer, String, Boolean
from .database import Base

class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True)
    title = Column(String, nullable=False)
    done = Column(Boolean, default=False)
    owner_id = Column(Integer, nullable=False)`,
    'app/routes.py': `from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from . import models, schemas, auth

router = APIRouter()

@router.get("/tasks")
async def list_tasks(
    db: Session = Depends(get_db),
    user = Depends(auth.current_user)
):
    return db.query(models.Task).filter_by(owner=user.id).all()

@router.post("/tasks")
async def create_task(task: schemas.TaskCreate, db: Session = Depends(get_db)):
    obj = models.Task(**task.dict())
    db.add(obj)
    db.commit()
    return obj`,
    'Dockerfile': `FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]`,
};

/* ─── Endpoint Test Panel Data ─── */
const ENDPOINTS = [
    {
        id: 'get-tasks',
        method: 'GET',
        path: '/tasks',
        description: 'Returns a list of all your tasks.',
        inputLabel: null,
        placeholder: null,
        mockResponse: JSON.stringify({ success: true, data: [{ id: 1, title: 'Buy groceries', done: false }, { id: 2, title: 'Walk the dog', done: true }] }, null, 2),
    },
    {
        id: 'post-task',
        method: 'POST',
        path: '/tasks',
        description: 'Creates a brand-new task.',
        inputLabel: 'Task title',
        placeholder: 'Buy groceries',
        mockResponse: JSON.stringify({ success: true, data: { id: 3, title: 'Buy groceries', done: false, created_at: '2026-02-20T16:00:00Z' } }, null, 2),
    },
    {
        id: 'get-task-id',
        method: 'GET',
        path: '/tasks/:id',
        description: 'Fetch one task by its ID.',
        inputLabel: 'Task ID',
        placeholder: '1',
        mockResponse: JSON.stringify({ success: true, data: { id: 1, title: 'Buy groceries', done: false } }, null, 2),
    },
    {
        id: 'put-complete',
        method: 'PUT',
        path: '/tasks/:id/complete',
        description: 'Marks a task as completed.',
        inputLabel: 'Task ID to complete',
        placeholder: '1',
        mockResponse: JSON.stringify({ success: true, data: { id: 1, title: 'Buy groceries', done: true } }, null, 2),
    },
    {
        id: 'delete-task',
        method: 'DELETE',
        path: '/tasks/:id',
        description: 'Permanently removes a task.',
        inputLabel: 'Task ID to delete',
        placeholder: '2',
        mockResponse: JSON.stringify({ success: true, message: 'Task 2 deleted.' }, null, 2),
    },
];

const METHOD_COLOR = { GET: '#22c55e', POST: '#60a5fa', PUT: '#f59e0b', DELETE: '#f87171' };

/* ─── Endpoint Card ─── */
function EndpointCard({ ep }) {
    const [inputVal, setInputVal] = useState('');
    const [response, setResponse] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleTry = async () => {
        setLoading(true);
        setResponse(null);
        await new Promise(r => setTimeout(r, 700));
        setLoading(false);
        setResponse(ep.mockResponse);
    };

    return (
        <div className="ep-card">
            <div className="ep-header">
                <span className="ep-method" style={{ color: METHOD_COLOR[ep.method] }}>{ep.method}</span>
                <code className="ep-path">{ep.path}</code>
            </div>
            <p className="ep-desc">{ep.description}</p>
            {ep.inputLabel && (
                <div className="ep-input-wrap">
                    <label className="ep-input-label">{ep.inputLabel}</label>
                    <input className="ep-input" value={inputVal} onChange={e => setInputVal(e.target.value)} placeholder={ep.placeholder} spellCheck={false} />
                </div>
            )}
            <button className={`ep-try-btn${loading ? ' loading' : ''}`} onClick={handleTry} disabled={loading}>
                {loading ? <span className="ep-spinner" /> : <><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>Try it</>}
            </button>
            <AnimatePresence>
                {response && (
                    <motion.div className="ep-response" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
                        <div className="ep-response-header">
                            <span className="ep-status-badge">200 OK</span>
                            <span className="ep-response-label">Response</span>
                        </div>
                        <pre className="ep-response-body">{response}</pre>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/* ─── Voice Recorder Hook ─── */
function useVoiceRecorder(onTranscript) {
    const [recording, setRecording] = useState(false);
    const mediaRef = useRef(null);

    const start = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            const chunks = [];
            recorder.ondataavailable = e => chunks.push(e.data);
            recorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                // In a real app you'd send audio to a speech-to-text API.
                // Here we simulate a transcription after a short delay.
                onTranscript('[Voice transcription would appear here — connect a speech-to-text API]');
            };
            recorder.start();
            mediaRef.current = recorder;
            setRecording(true);
        } catch {
            alert('Microphone access denied. Please allow microphone permissions.');
        }
    }, [onTranscript]);

    const stop = useCallback(() => {
        mediaRef.current?.stop();
        setRecording(false);
    }, []);

    const toggle = useCallback(() => {
        recording ? stop() : start();
    }, [recording, start, stop]);

    return { recording, toggle };
}

/* ─── Syntax Highlighter ─── */
const KEYWORDS = /\b(FROM|WORKDIR|COPY|RUN|CMD|ENV|EXPOSE|ENTRYPOINT|ARG|ADD|def|class|import|from|return|if|else|elif|for|while|async|await|with|as|try|except|finally|raise|pass|True|False|None|and|or|not|in|is|lambda|yield)\b/g;
const STRINGS = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;
const COMMENTS = /(#.*)$/gm;
const NUMBERS = /\b(\d+\.?\d*)\b/g;
const BUILTINS = /\b(print|len|range|enumerate|zip|map|filter|list|dict|set|tuple|str|int|float|bool|open|super|self|cls)\b/g;

function syntaxHighlight(code) {
    // Escape HTML first
    const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = esc.split('\n');
    return lines.map(line => {
        let out = line;
        out = out.replace(COMMENTS, m => `<span class="tok-comment">${m}</span>`);
        out = out.replace(STRINGS, (m, q, s) => `<span class="tok-string">${m}</span>`);
        out = out.replace(NUMBERS, m => `<span class="tok-number">${m}</span>`);
        out = out.replace(KEYWORDS, m => `<span class="tok-keyword">${m}</span>`);
        out = out.replace(BUILTINS, m => `<span class="tok-builtin">${m}</span>`);
        return out;
    }).join('\n');
}
export default function ChatPage({ theme, onThemeToggle }) {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const [triggerMenu, setTriggerMenu] = useState(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const [selectedModel, setSelectedModel] = useState('pro');
    const [threads, setThreads] = useState([]);
    const [activeThread, setActiveThread] = useState(() => localStorage.getItem('interius_active_thread'));
    const [messages, setMessages] = useState([]);
    const [isMessagesLoading, setIsMessagesLoading] = useState(() => Boolean(localStorage.getItem('interius_active_thread')));
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [typingStep, setTypingStep] = useState(0);
    const [panelMode, setPanelMode] = useState(null);
    const [previewFile, setPreviewFile] = useState(null);
    const [attachedFiles, setAttachedFiles] = useState([]);
    const [activeTab, setActiveTab] = useState('Local');
    const [editSuggestion, setEditSuggestion] = useState('');
    const [suggestOpen, setSuggestOpen] = useState(false);
    const [suggestAtMenu, setSuggestAtMenu] = useState(false);
    const [autoApprove, setAutoApprove] = useState(true);

    const modelDropdownRef = useRef(null);

    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const isGeneratingRef = useRef(false);
    const latestAgentMessage = [...messages].reverse().find((msg) => msg.type === 'agent');
    const pipelineInProgress = isTyping || (
        latestAgentMessage &&
        (latestAgentMessage.status === 'running' || latestAgentMessage.status === 'awaiting_approval')
    );

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isTyping]);

    // Close model dropdown on outside click
    useEffect(() => {
        const handler = (e) => { if (!modelDropdownRef.current?.contains(e.target)) setModelDropdownOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Load user's threads on mount
    useEffect(() => {
        if (!user) return;
        const fetchThreads = async () => {
            const { data } = await supabase.from('threads').select('*').order('created_at', { ascending: false });
            if (data) {
                setThreads(data);
                const saved = localStorage.getItem('interius_active_thread');
                if (saved && data.some(t => t.id === saved)) {
                    setActiveThread(saved);
                } else if (saved) {
                    localStorage.removeItem('interius_active_thread');
                    setActiveThread(null);
                    setIsMessagesLoading(false);
                }
            }
        };
        fetchThreads();
    }, [user]);

    // Load messages when activeThread changes
    useEffect(() => {
        if (!activeThread) {
            setMessages([]);
            setIsMessagesLoading(false);
            return;
        }

        if (isGeneratingRef.current) return;
        let cancelled = false;
        setIsMessagesLoading(true);

        const fetchMessages = async () => {
            const { data } = await supabase.from('messages')
                .select('*')
                .eq('thread_id', activeThread)
                .order('created_at', { ascending: true });

            if (cancelled) return;

            if (data) {
                // Parse the DB rows back into the frontend schema
                const formatted = data.map(msg => ({
                    id: msg.id,
                    type: msg.role,
                    text: msg.content,
                    files: [] // For simplicity in this demo
                }));
                // We ensure historical completed agent messages always have the deployment block state active
                // For simplicity in this demo, all agent messages are assumed to have reached phase 2 completion
                const withMockData = formatted.map(msg =>
                    msg.type === 'agent' ? {
                        ...msg,
                        files: AGENT_FINAL.files,
                        status: 'completed',
                        phase: 2,
                        stepIndex: 99
                    } : msg
                );
                setMessages(withMockData);
            }
            if (!cancelled) setIsMessagesLoading(false);
        };
        fetchMessages();

        return () => {
            cancelled = true;
        };
    }, [activeThread]);

    const { recording, toggle: toggleRecording } = useVoiceRecorder((text) => {
        setInput(prev => prev ? prev + ' ' + text : text);
    });

    const handleLogout = () => { logout(); navigate('/'); };

    const handleNewThread = () => {
        isGeneratingRef.current = false;
        setActiveThread(null);
        localStorage.removeItem('interius_active_thread');
        setMessages([]);
        setInput('');
        setAttachedFiles([]);
        setPanelMode(null);
        setPreviewFile(null);
    };

    const handleDeleteThread = async (e, id) => {
        e.stopPropagation();
        setThreads(t => t.filter(x => x.id !== id));
        if (activeThread === id) {
            setActiveThread(null);
            localStorage.removeItem('interius_active_thread');
            setMessages([]);
        }
        await supabase.from('threads').delete().eq('id', id);
    };

    const handleSuggestEdits = () => {
        setSuggestOpen(true);
    };

    const submitSuggestEdits = async () => {
        if (!editSuggestion.trim()) return;
        const prompt = `Please apply the following edits to ${previewFile}:\n\n${editSuggestion.trim()}`;
        setEditSuggestion('');
        setSuggestOpen(false);
        setPanelMode(null);
        setPreviewFile(null);
        await sendMessage(prompt);
    };

    const openFilePreviewer = (filename) => {
        setPreviewFile(filename);
        setPanelMode('file');
    };

    const handleTabClick = (tab) => {
        if (tab === 'Cloud') { window.open('https://app.interius.dev', '_blank'); return; }
        setActiveTab(tab);
    };

    const handleInsertTriggerOption = (value) => {
        setInput(prev => {
            const trigger = triggerMenu;
            const idx = prev.lastIndexOf(trigger);
            if (idx === -1) return prev + value;
            return prev.slice(0, idx) + value + ' ';
        });
        setTriggerMenu(null);
        inputRef.current?.focus();
    };

    const sendMessage = async (text) => {
        if (!text || isGeneratingRef.current || !user) return;

        isGeneratingRef.current = true;

        let threadId = activeThread;

        // Create new thread if none active
        if (!threadId) {
            const generatedTitle = await generateThreadTitle(text);
            const { data, error } = await supabase.from('threads').insert({
                user_id: user.id,
                title: generatedTitle
            }).select().single();

            if (!error && data) {
                threadId = data.id;
                setThreads(t => [data, ...t]);
                setActiveThread(threadId);
                localStorage.setItem('interius_active_thread', threadId);
            } else {
                console.error("Failed to create thread", error);
                return;
            }
        }

        // Add user message to UI
        setMessages(m => [...m, { type: 'user', text, files: attachedFiles.map(f => f.name) }]);
        setAttachedFiles([]);
        setIsTyping(true);

        // Save user message to DB
        await supabase.from('messages').insert({
            thread_id: threadId,
            user_id: user.id,
            role: 'user',
            content: text
        });

        // Initialize agent message in UI
        const msgId = Date.now();
        setMessages(m => [...m, {
            id: msgId,
            type: 'agent',
            isStreaming: true,
            phase: 1,
            stepIndex: 0,
            status: 'running'
        }]);

        // Simulate Phase 1 Streaming
        for (let i = 0; i < AGENT_PHASE_1.length; i++) {
            await new Promise(r => setTimeout(r, 650));
            setMessages(curr => curr.map(msg => msg.id === msgId ? { ...msg, stepIndex: i + 1 } : msg));
        }

        if (autoApprove) {
            // Simulate brief transition
            await new Promise(r => setTimeout(r, 400));

            // Advance to Phase 2
            setMessages(curr => curr.map(msg => msg.id === msgId ? { ...msg, phase: 2, stepIndex: 0 } : msg));

            for (let i = 0; i < AGENT_PHASE_2.length; i++) {
                await new Promise(r => setTimeout(r, 650));
                setMessages(curr => curr.map(msg => msg.id === msgId ? { ...msg, stepIndex: i + 1 } : msg));
            }

            // Finish fully
            await new Promise(r => setTimeout(r, 400));
            setIsTyping(false);

            const finalPayload = {
                isStreaming: false,
                status: 'completed',
                ...AGENT_FINAL
            };

            setMessages(curr => curr.map(msg => msg.id === msgId ? { ...msg, ...finalPayload } : msg));

            // Save final agent message to DB
            await supabase.from('messages').insert({
                thread_id: threadId,
                user_id: user.id,
                role: 'agent',
                content: AGENT_FINAL.text
            });

            isGeneratingRef.current = false;

        } else {
            // Halt at Human-in-the-Loop review phase
            setIsTyping(false);
            setMessages(curr => curr.map(msg => msg.id === msgId ? {
                ...msg,
                isStreaming: false,
                status: 'awaiting_approval'
            } : msg));
        }

        setPanelMode(null);
        inputRef.current?.focus();
    };

    const approvePhase1 = async (msgId) => {
        // Resume UI streaming for Phase 2
        setMessages(curr => curr.map(msg => msg.id === msgId ? {
            ...msg,
            isStreaming: true,
            phase: 2,
            stepIndex: 0,
            status: 'running'
        } : msg));

        for (let i = 0; i < AGENT_PHASE_2.length; i++) {
            await new Promise(r => setTimeout(r, 650));
            setMessages(curr => curr.map(msg => msg.id === msgId ? { ...msg, stepIndex: i + 1 } : msg));
        }

        await new Promise(r => setTimeout(r, 400));

        const finalPayload = {
            isStreaming: false,
            status: 'completed',
            ...AGENT_FINAL
        };

        setMessages(curr => curr.map(msg => msg.id === msgId ? { ...msg, ...finalPayload } : msg));

        // Save final agent message to DB
        await supabase.from('messages').insert({
            thread_id: activeThread,
            user_id: user.id,
            role: 'agent',
            content: AGENT_FINAL.text
        });

        isGeneratingRef.current = false;
    };

    const handleSend = async () => {
        const text = input.trim();
        if ((!text && attachedFiles.length === 0) || pipelineInProgress) return;
        setInput('');
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
        }
        await sendMessage(text);
    };

    const handleInputChange = (e) => {
        const val = e.target.value;
        setInput(val);
        const last = val[val.length - 1];
        if (last === '@') setTriggerMenu('@');
        else if (last === '/') setTriggerMenu('/');
        else if (triggerMenu && !val.includes(triggerMenu)) setTriggerMenu(null);
    };

    const handleKey = (e) => {
        if (e.key === 'Escape') { setTriggerMenu(null); return; }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    const handleFileChange = (e) => {
        const files = Array.from(e.target.files);
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB limit

        const validFiles = files.filter(f => {
            if (f.size > MAX_SIZE) {
                alert(`File "${f.name}" is too large. Maximum size is 5MB.`);
                return false;
            }
            return true;
        });

        setAttachedFiles(prev => [...prev, ...validFiles]);
        e.target.value = '';
    };

    const removeFile = (name) => setAttachedFiles(prev => prev.filter(f => f.name !== name));

    const fillSuggestion = (label) => { setInput(label); inputRef.current?.focus(); };

    return (
        <div className="chat-page" data-theme={theme}>

            {/* ── Sidebar (expanded) ── */}
            <aside className={`cp-sidebar${sidebarCollapsed ? ' hidden' : ''}`}>
                {/* Logo + collapse toggle */}
                <div className="cp-sidebar-logo">
                    <a href="/" className="cp-logo">
                        Interius<span className="cp-logo-dot">.</span>
                    </a>
                    <button className="cp-collapse-btn" onClick={() => setSidebarCollapsed(true)} title="Collapse sidebar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
                    </button>
                </div>



                {/* Threads */}
                <div className="cp-section cp-section-threads">
                    <div className="cp-section-header">
                        <div className="cp-section-label">Threads</div>
                        <button className="cp-section-action" title="New thread" onClick={handleNewThread}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                        </button>
                    </div>
                    {threads.map(t => (
                        <div key={t.id} className={`cp-thread-item${activeThread === t.id ? ' active' : ''}`}
                            onClick={() => {
                                isGeneratingRef.current = false;
                                localStorage.setItem('interius_active_thread', t.id);
                                setIsMessagesLoading(true);
                                setActiveThread(t.id);
                            }}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 6h14M5 12h10M5 18h7" /></svg>
                            <span className="cp-thread-title">{t.title}</span>
                            <button
                                className="cp-thread-delete"
                                title="Delete thread"
                                onClick={(e) => handleDeleteThread(e, t.id)}
                            >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </button>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="cp-sidebar-footer">
                    <ThemeToggle theme={theme} onToggle={onThemeToggle} />
                    <div className="cp-user">
                        <div className="cp-avatar">{user?.name?.[0]?.toUpperCase() || 'U'}</div>
                        <span className="cp-user-name">{user?.name || 'You'}</span>
                    </div>
                    <button className="cp-logout" onClick={handleLogout} title="Sign out">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                    </button>
                </div>
            </aside>

            {/* Collapsed sidebar rail */}
            {sidebarCollapsed && (
                <aside className="cp-sidebar-rail">
                    <button className="cp-rail-logo" onClick={() => setSidebarCollapsed(false)} title="Expand sidebar">
                        <span className="cp-rail-i">I</span><span className="cp-rail-dot">.</span>
                    </button>
                    <div className="cp-rail-actions">
                        <button className="cp-rail-btn" onClick={() => { setSidebarCollapsed(false); handleNewThread(); }} title="New thread">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                        </button>
                        <ThemeToggle theme={theme} onToggle={onThemeToggle} />
                    </div>
                </aside>
            )}

            {/* ── Main Chat ── */}
            <main className="cp-main">
                {/* Top bar */}
                <div className="cp-topbar">
                    <span className="cp-topbar-thread">
                        {activeThread ? threads.find(t => t.id === activeThread)?.title || 'New thread' : 'New thread'}
                    </span>
                </div>

                {/* Chat area */}
                <div className="cp-chat-area">
                    {isMessagesLoading && activeThread ? (
                        <div className="cp-chat-loading" role="status" aria-live="polite">
                            <div className="cp-chat-loading-spinner" />
                            <span>Loading thread…</span>
                        </div>
                    ) : messages.length === 0 && !isTyping ? (
                        <div className="cp-empty">
                            {/* Build icon */}
                            <div className="cp-empty-icon" style={{ fontSize: '44px', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em', userSelect: 'none' }}>
                                <span className="cp-rail-i">I</span><span className="cp-rail-dot">.</span>
                            </div>
                            <h2 className="cp-empty-heading">Let's build something.</h2>
                            <p className="cp-empty-project">
                                {selectedModel === 'pro' ? 'Interius Pro v1' : 'Interius Generalist v1'}
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
                            </p>


                            <div className="cp-suggestions">
                                {(SUGGESTIONS[selectedModel] || []).map(s => (
                                    <button key={s.label} className="cp-suggestion" onClick={() => fillSuggestion(s.label)}>
                                        <span className="cp-suggestion-label">{s.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="cp-messages">
                            <AnimatePresence initial={false}>
                                {messages.map((msg, i) => (
                                    <motion.div key={i} className={`cp-msg ${msg.type}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
                                        {msg.type === 'user' ? (
                                            <div className="cp-user-msg">
                                                {msg.files?.length > 0 && (
                                                    <div className="cp-attached-files">
                                                        {msg.files.map(f => (
                                                            <div key={f} className="cp-file-chip">
                                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                                                {f}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {msg.text && <div className="cp-bubble">{msg.text}</div>}
                                            </div>
                                        ) : (
                                            <div className="cp-agent-wrap">
                                                <div className="cp-agent-avatar">
                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                                        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                                                    </svg>
                                                </div>
                                                <div className="cp-agent-body">
                                                    {/* Thought Process Tree */}
                                                    <div className="cp-thought-process">
                                                        <details className="cp-thought-details" open>
                                                            <summary className="cp-thought-summary">
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21" /></svg> View thought process
                                                            </summary>
                                                            <div className="cp-thought-tree">

                                                                {/* Render Phase 1 */}
                                                                {(msg.phase >= 1) && AGENT_PHASE_1.map((step, idx) => {
                                                                    const isPast = msg.phase > 1 || (msg.phase === 1 && msg.stepIndex > idx) || msg.status === 'completed';
                                                                    const isCurrent = msg.phase === 1 && msg.stepIndex === idx && msg.isStreaming;
                                                                    if (!isPast && !isCurrent) return null;

                                                                    return (
                                                                        <div key={step.id} className={`cp-tree-node ${isCurrent ? 'running' : 'done'}`}>
                                                                            <div className="cp-tree-main">
                                                                                {isCurrent ? (
                                                                                    <span className="cp-run-spinner" />
                                                                                ) : (
                                                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLineJoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                                                                )}
                                                                                <span>{isCurrent ? step.text : step.doneText}</span>
                                                                            </div>
                                                                            {isPast && step.sub && (
                                                                                <div className="cp-tree-sub">
                                                                                    {step.sub.map((s, sIdx) => (
                                                                                        <div key={sIdx} className="cp-tree-sub-item">
                                                                                            <span className="cp-tree-elbow">└─</span>
                                                                                            {autoApprove ? <span className="cp-sub-auto">Autoapproved</span> : <span className="cp-sub-auto">—</span>}
                                                                                            {s.action.startsWith('file:') ? (
                                                                                                <button onClick={() => openFilePreviewer(s.action.split(':')[1])} className="cp-tree-link">
                                                                                                    {s.label} <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17l9.2-9.2M17 17V7H7" /></svg>
                                                                                                </button>
                                                                                            ) : (
                                                                                                <a href={s.action.split(':')[1]} target="_blank" rel="noreferrer" className="cp-tree-link">
                                                                                                    {s.label} <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17l9.2-9.2M17 17V7H7" /></svg>
                                                                                                </a>
                                                                                            )}
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}

                                                                {/* Render Phase 2 */}
                                                                {(msg.phase >= 2) && AGENT_PHASE_2.map((step, idx) => {
                                                                    const isPast = msg.phase > 2 || (msg.phase === 2 && msg.stepIndex > idx) || msg.status === 'completed';
                                                                    const isCurrent = msg.phase === 2 && msg.stepIndex === idx && msg.isStreaming;
                                                                    if (!isPast && !isCurrent) return null;

                                                                    return (
                                                                        <div key={step.id} className={`cp-tree-node ${isCurrent ? 'running' : 'done'}`}>
                                                                            <div className="cp-tree-main">
                                                                                {isCurrent ? (
                                                                                    <span className="cp-run-spinner" />
                                                                                ) : (
                                                                                    step.icon === 'deploy' ?
                                                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLineJoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                                                                        : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLineJoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                                                                )}
                                                                                <span>{isCurrent ? step.text : step.doneText}</span>
                                                                            </div>
                                                                            {isPast && step.sub && (
                                                                                <div className="cp-tree-sub">
                                                                                    {step.sub.map((s, sIdx) => (
                                                                                        <div key={sIdx} className="cp-tree-sub-item">
                                                                                            <span className="cp-tree-elbow">└─</span>
                                                                                            {autoApprove ? <span className="cp-sub-auto">Autoapproved</span> : <span className="cp-sub-auto">—</span>}
                                                                                            {s.action.startsWith('file:') ? (
                                                                                                <button onClick={() => openFilePreviewer(s.action.split(':')[1])} className="cp-tree-link">
                                                                                                    {s.label}
                                                                                                </button>
                                                                                            ) : (
                                                                                                <a href={s.action.split(':')[1]} target="_blank" rel="noreferrer" className="cp-tree-link">
                                                                                                    {s.label} <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17l9.2-9.2M17 17V7H7" /></svg>
                                                                                                </a>
                                                                                            )}
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </details>
                                                    </div>

                                                    {/* Human in the loop halt block */}
                                                    {msg.status === 'awaiting_approval' && (
                                                        <div className="cp-review-block">
                                                            <div className="cp-review-content">
                                                                <p>I have generated the Initial Requirements and Architecture. Please review them.</p>
                                                            </div>
                                                            <div className="cp-review-actions">
                                                                <button className="cp-action-btn cp-action-approve" onClick={() => approvePhase1(msg.id)}>
                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                                                                    Approve to Continue
                                                                </button>
                                                                <button className="cp-action-btn cp-action-suggest" onClick={() => { setPreviewFile('Requirements Document'); setPanelMode('file'); setSuggestOpen(true); }}>
                                                                    Suggest Edits
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Final output block */}
                                                    {msg.status === 'completed' && msg.text && (
                                                        <div className="cp-final-output">
                                                            <p className="cp-agent-text">{msg.text}</p>

                                                            {msg.files?.length > 0 && (
                                                                <div className="cp-agent-files-group">
                                                                    {msg.files.map(f => (
                                                                        <button key={f} className="cp-file-pill code-chip" onClick={() => openFilePreviewer(f)}>
                                                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                                                            {f}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}

                                                            {/* Always show deployment blocks for completed pipeline phases, regardless of explicit payload flags */}
                                                            {msg.status === 'completed' && msg.phase >= 2 && (
                                                                <div className="cp-deployment-blocks">
                                                                    <div className="cp-deploy-block">
                                                                        <div className="cp-deploy-content">
                                                                            Use the interactive API playground to test your generated endpoints.
                                                                        </div>
                                                                        <button className="cp-action-btn cp-action-tester" onClick={() => { setPreviewFile(null); setPanelMode('tester'); }}>
                                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
                                                                            Test API Endpoints
                                                                        </button>
                                                                    </div>
                                                                    <div className="cp-deploy-block">
                                                                        <div className="cp-deploy-content">
                                                                            Your backend has been packaged and containerized via <a href="https://hub.docker.com/" target="_blank" className="cp-tree-link">dockerhub ↗</a> and deployed to production.
                                                                        </div>
                                                                        <a className="cp-action-btn cp-action-live" href="https://app.interius.dev" target="_blank" rel="noopener noreferrer">
                                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                                                                            View Live API
                                                                        </a>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </motion.div>
                                ))}


                            </AnimatePresence>
                            <div ref={messagesEndRef} />
                        </div>
                    )}
                </div>

                {/* ── Input Bar ── */}
                <div className="cp-input-bar">
                    {/* Attached files preview */}
                    {attachedFiles.length > 0 && (
                        <div className="cp-file-preview">
                            {attachedFiles.map(f => (
                                <div key={f.name} className="cp-file-tag">
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                    {f.name}
                                    <button className="cp-file-remove" onClick={() => removeFile(f.name)}>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* @ and / trigger menus */}
                    <AnimatePresence>
                        {triggerMenu && (
                            <motion.div
                                className="cp-trigger-menu"
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 6 }}
                                transition={{ duration: 0.15 }}
                            >
                                {triggerMenu === '@' && FILE_OPTIONS.map(f => (
                                    <button key={f.label} className="cp-trigger-item" onClick={() => handleInsertTriggerOption(f.label)}>
                                        <span className="cp-trigger-icon">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                        </span>
                                        {f.label}
                                    </button>
                                ))}
                                {triggerMenu === '/' && COMMAND_OPTIONS.map(c => (
                                    <button key={c.cmd} className="cp-trigger-item" onClick={() => handleInsertTriggerOption(c.cmd)}>
                                        <span className="cp-trigger-cmd">{c.cmd}</span>
                                        <span className="cp-trigger-desc">{c.desc}</span>
                                    </button>
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div className="cp-input-wrap">
                        {/* Left: attach */}
                        <button className="cp-input-action cp-attach" onClick={() => fileInputRef.current?.click()} title="Attach file">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                        </button>
                        <input ref={fileInputRef} type="file" multiple accept=".txt,.pdf,.md" className="cp-file-input" onChange={handleFileChange} />

                        {/* Textarea */}
                        <textarea
                            ref={inputRef}
                            className="cp-textarea"
                            placeholder="Ask Interius anything…"
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={handleKey}
                            onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                            rows={1}
                        />

                        {/* Right actions */}
                        <div className="cp-input-right">
                            <button
                                className={`cp-input-action cp-mic${recording ? ' recording' : ''}`}
                                onClick={toggleRecording}
                                title={recording ? 'Stop recording' : 'Voice input'}
                            >
                                {recording ? (
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="6" y="6" width="12" height="12" rx="2" />
                                    </svg>
                                ) : (
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                                    </svg>
                                )}
                            </button>
                            <button
                                className={`cp-send${(input.trim() || attachedFiles.length > 0) ? ' active' : ''}${pipelineInProgress ? ' loading' : ''}`}
                                onClick={handleSend}
                                disabled={(!input.trim() && attachedFiles.length === 0) || pipelineInProgress}
                                aria-label={pipelineInProgress ? 'Model is still processing' : 'Send'}
                                title={pipelineInProgress ? 'Model is still processing...' : 'Send'}
                            >
                                {pipelineInProgress ? (
                                    <span className="cp-send-spinner" aria-hidden="true" />
                                ) : (
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94l18.04-8.01a.75.75 0 000-1.36L3.478 2.405z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Bottom bar */}
                    <div className="cp-input-footer">
                        <div className="cp-model-selector" ref={modelDropdownRef}>
                            <button
                                className={`cp-model-btn${modelDropdownOpen ? ' open' : ''}`}
                                onClick={() => setModelDropdownOpen(o => !o)}
                            >
                                <span className="cp-model-dot" />
                                <span className="cp-model-name">
                                    {selectedModel === 'pro' ? 'Interius Pro v1' : 'Interius Generalist v1'}
                                </span>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
                            </button>
                            {modelDropdownOpen && (
                                <div className="cp-model-dropdown">
                                    <button
                                        className={`cp-model-option${selectedModel === 'pro' ? ' selected' : ''}`}
                                        onClick={() => { setSelectedModel('pro'); setModelDropdownOpen(false); }}
                                    >
                                        <span className="cp-model-option-name">Interius Pro v1</span>
                                        <span className="cp-model-option-desc">Specialized API builder & scaffolder</span>
                                    </button>
                                    <button
                                        className={`cp-model-option${selectedModel === 'generalist' ? ' selected' : ''}`}
                                        onClick={() => { setSelectedModel('generalist'); setModelDropdownOpen(false); }}
                                    >
                                        <span className="cp-model-option-name">Interius Generalist v1</span>
                                        <span className="cp-model-option-desc">Broad backend dev services, infra, tooling</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="cp-autoapprove-toggle" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', userSelect: 'none' }}>
                            <label className="cp-switch" style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px' }}>
                                <input
                                    type="checkbox"
                                    checked={autoApprove}
                                    onChange={(e) => setAutoApprove(e.target.checked)}
                                    style={{ opacity: 0, width: 0, height: 0 }}
                                />
                                <span className="cp-slider" style={{
                                    position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                    backgroundColor: autoApprove ? 'var(--accent)' : 'var(--bg-secondary)',
                                    border: `1px solid ${autoApprove ? 'var(--accent)' : 'var(--border-subtle)'}`,
                                    boxShadow: autoApprove ? '0 0 0 2px var(--accent-glow)' : 'inset 0 0 0 1px var(--border-subtle)',
                                    transition: '.3s',
                                    borderRadius: '18px'
                                }}>
                                    <span style={{
                                        position: 'absolute', content: '""', height: '14px', width: '14px', left: '2px', bottom: '2px',
                                        backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', transition: '.3s', borderRadius: '50%',
                                        transform: autoApprove ? 'translateX(14px)' : 'translateX(0)'
                                    }} />
                                </span>
                            </label>
                            Auto-Approve
                        </div>
                    </div>
                </div>
            </main>

            {/* ── Right Panel: API Tester / File Preview ── */}
            <AnimatePresence>
                {panelMode && (
                    <motion.aside
                        className="cp-right-panel"
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: panelMode === 'file' ? 660 : 440, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
                    >
                        <div className="cp-rp-inner">
                            <div className="cp-rp-header">
                                <div className="cp-rp-title-wrap">
                                    {panelMode === 'file' ? (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                    ) : (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
                                    )}
                                    <span className="cp-rp-title">{panelMode === 'file' ? previewFile : 'API Tester'}</span>
                                </div>
                                <button className="cp-rp-close" onClick={() => { setPanelMode(null); setPreviewFile(null); }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            </div>

                            {panelMode === 'tester' && (
                                <>
                                    <div className="cp-rp-swagger">
                                        <a
                                            href="https://app.interius.dev/docs"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="cp-swagger-btn"
                                        >
                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" /></svg>
                                            Open Swagger UI
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                                        </a>
                                    </div>
                                    <p className="cp-rp-desc">Try your endpoints live — no setup or code needed.</p>
                                    <div className="cp-rp-endpoints">
                                        {ENDPOINTS.map(ep => <EndpointCard key={ep.id} ep={ep} />)}
                                    </div>
                                </>
                            )}

                            {panelMode === 'file' && previewFile && (
                                <div className="cp-file-viewer">
                                    <div className="cp-ide-toolbar">
                                        <span className="cp-ide-filename">{previewFile}</span>
                                    </div>
                                    <div className="cp-ide-scroll">
                                        <table className="cp-ide-table">
                                            <tbody>
                                                {(MOCK_FILES[previewFile] ?? '// File content not available').split('\n').map((line, i) => (
                                                    <tr key={i} className="cp-ide-row">
                                                        <td className="cp-ide-ln">{i + 1}</td>
                                                        <td className="cp-ide-line" dangerouslySetInnerHTML={{ __html: syntaxHighlight(line) || '&nbsp;' }} />
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="cp-suggest-footer">
                                        {suggestOpen ? (
                                            <div style={{ position: 'relative' }}>
                                                {suggestAtMenu && (
                                                    <div className="cp-suggest-at-menu">
                                                        {Object.keys(MOCK_FILES).map(f => (
                                                            <button
                                                                key={f}
                                                                className="cp-suggest-at-item"
                                                                onMouseDown={e => {
                                                                    e.preventDefault();
                                                                    const atIdx = editSuggestion.lastIndexOf('@');
                                                                    const newVal = editSuggestion.slice(0, atIdx) + '@' + f + ' ';
                                                                    setEditSuggestion(newVal);
                                                                    setSuggestAtMenu(false);
                                                                }}
                                                            >
                                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                                                {f}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                                <textarea
                                                    autoFocus
                                                    className="cp-suggest-input"
                                                    placeholder={`Describe edits… type @ to mention a file (Enter to send)`}
                                                    value={editSuggestion}
                                                    onChange={e => {
                                                        const val = e.target.value;
                                                        setEditSuggestion(val);
                                                        const last = val[val.length - 1];
                                                        if (last === '@') setSuggestAtMenu(true);
                                                        else if (suggestAtMenu && val.indexOf('@') === -1) setSuggestAtMenu(false);
                                                    }}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter' && !e.shiftKey) {
                                                            e.preventDefault();
                                                            submitSuggestEdits();
                                                        }
                                                        if (e.key === 'Escape') {
                                                            if (suggestAtMenu) { setSuggestAtMenu(false); return; }
                                                            setSuggestOpen(false);
                                                            setEditSuggestion('');
                                                        }
                                                    }}
                                                    rows={3}
                                                />
                                            </div>
                                        ) : (
                                            <button
                                                className="cp-suggest-btn active"
                                                onClick={handleSuggestEdits}
                                            >
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                                                Suggest edits
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>
        </div>
    );
}
