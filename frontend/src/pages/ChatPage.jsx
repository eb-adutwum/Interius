import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/ThemeToggle';
import { supabase } from '../lib/supabase';
import { generateThreadTitle } from '../lib/llm';
import {
    routeChatIntent,
    getInterfaceThreadContext,
    setInterfaceThreadContextFromMessages,
    appendInterfaceThreadContext,
    copyInterfaceThreadContext,
    clearInterfaceThreadContext,
    clearAllInterfaceThreadContexts,
} from '../lib/interface';
import { streamThreadChatGeneration } from '../lib/generateStream';
import {
    ingestThreadFiles,
    getThreadFileContextSummaries,
    getThreadBuildContextFiles,
    mergeThreadFileMetadata,
    copyThreadFileContext,
    clearThreadFileContext,
    clearAllThreadFileContexts,
} from '../lib/threadFileContext';
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
        sub: [
            { label: 'Extract entities and endpoints' },
            { label: 'Validate business rules' },
            { label: 'Produce requirements spec' },
        ]
    },
    {
        id: 'arch',
        text: 'Planning architecture…',
        doneText: 'Architecture designed.',
        sub: [
            { label: 'Define service layers' },
            { label: 'Map auth (if needed) and data flow' },
            { label: 'Generate architecture blueprint' },
        ]
    }
];

const AGENT_PHASE_2 = [
    {
        id: 'code',
        text: 'Generating code…',
        doneText: 'Code generation complete.',
        sub: [
            { label: 'Scaffold project structure' },
            { label: 'Implement models and routes' },
            { label: 'Assemble runnable backend' }
        ]
    },
    {
        id: 'review',
        text: 'Reviewing generated code…',
        doneText: 'Review completed.',
        sub: [
            { label: 'Check correctness and security' },
            { label: 'Apply fixes if needed' },
            { label: 'Finalize code package' },
        ]
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

const MOCK_EXPORT_ROOT = 'backend';
const THREAD_UI_CACHE_PREFIX = 'interius_thread_ui_cache:';
const THREAD_UI_CACHE_TTL_MS = 30 * 60 * 1000;
const TEMP_STOP_AFTER_ARCHITECTURE = false; // Set true only when isolating requirements+architecture for diagram debugging.

function threadUiCacheKey(threadId) {
    return `${THREAD_UI_CACHE_PREFIX}${threadId}`;
}

function getCacheStorages() {
    if (typeof window === 'undefined') return [];
    return [window.sessionStorage, window.localStorage];
}

function readThreadUiCache(threadId) {
    if (!threadId || typeof window === 'undefined') return null;
    for (const storage of getCacheStorages()) {
        try {
            const raw = storage.getItem(threadUiCacheKey(threadId));
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            const updatedAt = Number(parsed?.updatedAt || 0);
            if (!updatedAt || (Date.now() - updatedAt) > THREAD_UI_CACHE_TTL_MS) {
                storage.removeItem(threadUiCacheKey(threadId));
                continue;
            }
            return parsed;
        } catch {
            continue;
        }
    }
    return null;
}

function writeThreadUiCache(threadId, patch) {
    if (!threadId || typeof window === 'undefined') return;
    const current = readThreadUiCache(threadId) || {};
    const payload = JSON.stringify({
        ...current,
        ...patch,
        updatedAt: Date.now(),
    });
    for (const storage of getCacheStorages()) {
        try {
            storage.setItem(threadUiCacheKey(threadId), payload);
        } catch {
            // Ignore quota/storage write failures; cache is best-effort only.
        }
    }
}

function clearThreadUiCache(threadId) {
    if (!threadId || typeof window === 'undefined') return;
    for (const storage of getCacheStorages()) {
        try {
            storage.removeItem(threadUiCacheKey(threadId));
        } catch {
            // no-op
        }
    }
}

function clearAllThreadUiCaches() {
    if (typeof window === 'undefined') return;
    for (const storage of getCacheStorages()) {
        const keys = [];
        for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (key?.startsWith(THREAD_UI_CACHE_PREFIX)) keys.push(key);
        }
        keys.forEach((k) => {
            try {
                storage.removeItem(k);
            } catch {
                // no-op
            }
        });
    }
}

function buildPreviewMapFromEntries(entries) {
    const nextMap = {};
    const list = Array.isArray(entries) ? entries : [entries];

    for (const entry of list) {
        const path = entry?.path;
        const content = entry?.content;
        if (!path || typeof content !== 'string') continue;
        nextMap[path] = content;
        if (path === 'Requirements Document.md') nextMap['Requirements Document'] = content;
        if (path === 'Architecture Design.md') nextMap['Architecture Design'] = content;
    }

    return nextMap;
}

async function persistMessageArtifactBundle({ threadId, messageId, userId, agentState, previewFiles }) {
    if (!threadId || !messageId || !userId) return;
    const payload = {
        version: 1,
        agent_state: agentState || null,
        preview_files: previewFiles || {},
    };

    const { error } = await supabase
        .from('message_artifacts')
        .upsert(
            {
                thread_id: threadId,
                message_id: messageId,
                user_id: userId,
                payload,
            },
            { onConflict: 'message_id' }
        );

    if (error) {
        console.warn('Failed to persist message artifacts (table may not exist yet):', error);
    }
}

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
    const lines = String(code ?? '').split('\n');
    return lines.map((line) => {
        const placeholders = [];
        const stash = (html) => {
            const token = `@@TOK${placeholders.length}@@`;
            placeholders.push(html);
            return token;
        };

        let work = line;
        work = work.replace(COMMENTS, (m) => stash(`<span class="tok-comment">${escapeHtml(m)}</span>`));
        work = work.replace(STRINGS, (m) => stash(`<span class="tok-string">${escapeHtml(m)}</span>`));
        work = escapeHtml(work);
        work = work.replace(NUMBERS, (m) => `<span class="tok-number">${m}</span>`);
        work = work.replace(KEYWORDS, (m) => `<span class="tok-keyword">${m}</span>`);
        work = work.replace(BUILTINS, (m) => `<span class="tok-builtin">${m}</span>`);
        work = work.replace(/@@TOK(\d+)@@/g, (_m, idx) => placeholders[Number(idx)] || '');
        return work;
    }).join('\n');
}

function escapeHtml(code) {
    return code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function shouldSyntaxHighlightFile(filename) {
    const name = String(filename || '').toLowerCase();
    return (
        name.endsWith('.py') ||
        name.endsWith('.js') ||
        name.endsWith('.jsx') ||
        name.endsWith('.ts') ||
        name.endsWith('.tsx') ||
        name.endsWith('.json') ||
        name.endsWith('.yml') ||
        name.endsWith('.yaml') ||
        name.endsWith('.env') ||
        name.endsWith('.sql') ||
        name.endsWith('.sh') ||
        name.endsWith('.dockerfile') ||
        name === 'dockerfile' ||
        name.endsWith('.md') === false && name.includes('requirements.txt')
    );
}

function flattenReactText(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(flattenReactText).join('');
    if (node?.props?.children != null) return flattenReactText(node.props.children);
    return '';
}

function parseRequirementFieldListItem(children) {
    const text = flattenReactText(children).replace(/\s+/g, ' ').trim();
    const m = text.match(/^([^:]+):\s*([^(]+?)\s*\((required|optional)\)$/i);
    if (!m) return null;
    return {
        name: m[1].trim(),
        type: m[2].trim(),
        required: m[3].toLowerCase(),
    };
}

function normalizeMermaidCode(input) {
    let code = (input || '').trim();
    if (!code) return '';

    const fenced = code.match(/```(?:mermaid)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) code = fenced[1].trim();

    const firstLine = code.split('\n')[0]?.trim();
    if (/^mermaid$/i.test(firstLine)) {
        code = code.split('\n').slice(1).join('\n').trim();
    }

    return code
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/\t/g, '  ')
        .trim();
}

function preferTopDownMermaid(code) {
    return code.replace(/^\s*(flowchart|graph)\s+(LR|RL)\b/i, (_m, kind, _dir) => {
        const normalizedKind = String(kind).toLowerCase() === 'graph' ? 'flowchart' : kind;
        return `${normalizedKind} TD`;
    });
}

function stripMermaidEdgeLabels(code) {
    return code
        .replace(/(-->|==>|-.->)\|[^|\n]*\|/g, '$1')
        .replace(/(-->|==>|-.->)\s+\|[^|\n]*\|/g, '$1');
}

function normalizeMermaidEdgeLabelText(code) {
    return code.replace(/\|([^|\n]*)\|/g, (_m, label) => {
        const safe = String(label)
            .replace(/->/g, '→')
            .replace(/<-/g, '←')
            .replace(/\s{2,}/g, ' ')
            .trim();
        return `|${safe}|`;
    });
}

function quoteMermaidBracketLabels(code) {
    return code.replace(
        /(\b[A-Za-z][\w-]*)\[([^\]\n]+)\]/g,
        (_, id, label) => `${id}["${String(label).replace(/"/g, '\\"')}"]`
    );
}

function normalizeMermaidLines(code) {
    return code
        .split('\n')
        .map((line) => line.replace(/^\s*[-*]\s+/, '').trimEnd())
        .filter((line, idx, arr) => !(idx > 0 && !line && !arr[idx - 1]))
        .join('\n')
        .trim();
}

function stripFlowchartNotes(code) {
    return code
        .split('\n')
        .filter((line) => !/^\s*note\s+(left|right)\s+of\b/i.test(line))
        .join('\n')
        .trim();
}

function expandMermaidAmpersandNodes(code) {
    const lines = code.split('\n');
    const out = [];
    for (const line of lines) {
        const m = line.match(/^(\s*)(.+?)\s*&\s*(.+)$/);
        if (!m) {
            out.push(line);
            continue;
        }
        // Only expand inside node declaration-like lines, e.g. A[...] & B[...]
        if (!/[\[\(\{]/.test(line)) {
            out.push(line);
            continue;
        }
        const indent = m[1] || '';
        const parts = line.split('&').map((p) => p.trim()).filter(Boolean);
        if (parts.length <= 1) {
            out.push(line);
            continue;
        }
        for (const part of parts) out.push(`${indent}${part}`);
    }
    return out.join('\n');
}

function rewriteUnsupportedDottedLabeledEdges(code) {
    return code
        .replace(/---\s*\|\s*([^|\n]+?)\s*\|\s*/g, (_m, label) => `-. ${String(label).trim()} .-> `)
        .replace(/---/g, '-.->');
}

function simplifyMermaidForFallback(code) {
    return code
        .split('\n')
        .filter((line) => !/^\s*style\s+/i.test(line))
        .map((line) => line.replace(/\|[^|\n]*\|/g, ''))
        .join('\n')
        .replace(/\s+-\.\s+[^.\n]+?\s+\.\->\s+/g, ' -.-> ')
        .trim();
}

function makeMermaidUltraSafe(code) {
    return code
        .split('\n')
        .map((line) => {
            let out = line;
            // Drop labels on edges completely in last-resort mode.
            out = out.replace(/\|[^|\n]*\|/g, '');
            // Normalize dotted arrows to plain arrows for parser compatibility.
            out = out.replace(/-\.\->/g, '-->');
            out = out.replace(/---/g, '-->');
            // Flatten quoted node labels to simple ID labels.
            out = out.replace(/\b([A-Za-z][\w-]*)\s*\[\s*"[^"\n]*"\s*\]/g, (_m, id) => `${id}[${id}]`);
            // Flatten bare bracket labels with punctuation-heavy content.
            out = out.replace(/\b([A-Za-z][\w-]*)\s*\[\s*([^\]\n]+)\s*\]/g, (_m, id) => `${id}[${id}]`);
            // Flatten rounded/cylindrical node syntaxes to simple square nodes.
            out = out.replace(/\b([A-Za-z][\w-]*)\s*\(\((?:[^\n()]*)\)\)/g, (_m, id) => `${id}[${id}]`);
            out = out.replace(/\b([A-Za-z][\w-]*)\s*\(\s*([^\n()]*)\s*\)/g, (_m, id) => `${id}[${id}]`);
            return out;
        })
        .filter((line) => !/^\s*style\s+/i.test(line))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function stripMermaidStyleDirectives(code) {
    return code
        .split('\n')
        .filter((line) => !/^\s*style\s+[A-Za-z][\w-]*\s+/i.test(line))
        .join('\n')
        .trim();
}

function stripMermaidSubgraphBlocks(code) {
    return code
        .split('\n')
        .filter((line) => !/^\s*subgraph\b/i.test(line) && !/^\s*end\b/i.test(line))
        .join('\n')
        .trim();
}

function rewriteSubgraphEdgesToNodeEdges(code) {
    const lines = code.split('\n');
    const subgraphNodes = new Map();
    let currentSubgraph = null;
    for (const raw of lines) {
        const line = raw.trim();
        const sg = line.match(/^subgraph\s+([A-Za-z][\w-]*)\b/i);
        if (sg) {
            currentSubgraph = sg[1];
            if (!subgraphNodes.has(currentSubgraph)) subgraphNodes.set(currentSubgraph, []);
            continue;
        }
        if (/^end\b/i.test(line)) {
            currentSubgraph = null;
            continue;
        }
        if (!currentSubgraph) continue;
        const nodeMatch = line.match(/^([A-Za-z][\w-]*)\s*[\[\(\{]/);
        if (nodeMatch) {
            subgraphNodes.get(currentSubgraph).push(nodeMatch[1]);
        }
    }

    const out = [];
    for (const raw of lines) {
        const trimmed = raw.trim();
        const edgeMatch = trimmed.match(/^([A-Za-z][\w-]*)\s*(-->|==>|-.->)(\|[^|]*\|)?\s*([A-Za-z][\w-]*)\s*$/);
        if (!edgeMatch) {
            out.push(raw);
            continue;
        }
        const [, left, arrow, label = '', right] = edgeMatch;
        const leftMembers = subgraphNodes.get(left);
        const rightMembers = subgraphNodes.get(right);
        if (!leftMembers && !rightMembers) {
            out.push(raw);
            continue;
        }
        const indent = raw.match(/^\s*/)?.[0] || '';
        if (leftMembers && !rightMembers) {
            leftMembers.forEach((n) => out.push(`${indent}${n} ${arrow}${label ? label : ''} ${right}`));
            continue;
        }
        if (!leftMembers && rightMembers) {
            rightMembers.forEach((n) => out.push(`${indent}${left} ${arrow}${label ? label : ''} ${n}`));
            continue;
        }
        // Both are subgraphs; connect Cartesian but cap to avoid explosions.
        const pairs = [];
        leftMembers.forEach((l) => rightMembers.forEach((r) => pairs.push([l, r])));
        pairs.slice(0, 12).forEach(([l, r]) => out.push(`${indent}${l} ${arrow}${label ? label : ''} ${r}`));
    }
    return out.join('\n');
}

function buildMermaidCandidates(input) {
    const base = preferTopDownMermaid(
        rewriteSubgraphEdgesToNodeEdges(
            expandMermaidAmpersandNodes(
                rewriteUnsupportedDottedLabeledEdges(
                    normalizeMermaidEdgeLabelText(
                        stripFlowchartNotes(
                    normalizeMermaidLines(normalizeMermaidCode(input))
                        )
                    )
                )
            )
        )
    );
    if (!base) return [];

    const candidates = [
        base,
        stripMermaidEdgeLabels(base),
        stripMermaidStyleDirectives(base),
        stripMermaidEdgeLabels(stripMermaidStyleDirectives(base)),
        quoteMermaidBracketLabels(base),
        quoteMermaidBracketLabels(stripMermaidEdgeLabels(base)),
        quoteMermaidBracketLabels(stripMermaidEdgeLabels(stripMermaidStyleDirectives(base))),
        simplifyMermaidForFallback(base),
        quoteMermaidBracketLabels(simplifyMermaidForFallback(base)),
        stripMermaidSubgraphBlocks(stripMermaidEdgeLabels(base)),
        quoteMermaidBracketLabels(stripMermaidSubgraphBlocks(stripMermaidEdgeLabels(base))),
        makeMermaidUltraSafe(stripMermaidSubgraphBlocks(base)),
    ];

    return [...new Set(candidates.map((c) => c.trim()).filter(Boolean))];
}

function hasMermaidErrorSvg(svg) {
    const text = String(svg || '');
    return /Syntax error in text|Parse error on line|Lexical error on line|mermaid version\s+\d/i.test(text);
}

function sanitizeMermaidRenderedSvg(svg) {
    let out = String(svg || '');
    if (!out) return out;
    // Remove Mermaid error blocks/labels that can be appended to otherwise rendered diagrams.
    out = out.replace(/<g[^>]*class="[^"]*error[^"]*"[\s\S]*?<\/g>/gi, '');
    out = out.replace(/<text[^>]*>\s*(?:Syntax error[\s\S]*?|Parse error[\s\S]*?|Lexical error[\s\S]*?|mermaid version[\s\S]*?)<\/text>/gi, '');
    out = out.replace(/<foreignObject[\s\S]*?(?:Syntax error|Parse error|Lexical error|mermaid version)[\s\S]*?<\/foreignObject>/gi, '');
    return out;
}

function cleanupLeakedMermaidErrorArtifacts() {
    if (typeof document === 'undefined') return;
    const leakCandidates = Array.from(document.body?.children || []);
    leakCandidates.forEach((el) => {
        const text = String(el?.textContent || '');
        if (!/Syntax error in text|Parse error on line|Lexical error on line|mermaid version\s+\d/i.test(text)) {
            return;
        }
        const tag = el.tagName?.toLowerCase();
        if (tag === 'svg' || tag === 'pre' || tag === 'div') {
            el.remove();
        }
    });
}

function formatDurationMs(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return null;
    if (value < 1000) return `${Math.round(value)}ms`;
    if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
    const mins = Math.floor(value / 60_000);
    const secs = Math.round((value % 60_000) / 1000);
    return `${mins}m ${secs}s`;
}

function getStageDuration(msg, stage) {
    return formatDurationMs(msg?.stageTimings?.[stage]?.durationMs);
}

function MermaidPreview({ code, theme }) {
    const [svg, setSvg] = useState('');
    const [error, setError] = useState('');
    const renderIdRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 10)}`);

    useEffect(() => {
        let cancelled = false;
        const render = async () => {
            setError('');
            cleanupLeakedMermaidErrorArtifacts();
            if (!code?.trim()) {
                setSvg('');
                return;
            }
            try {
                const mermaid = (await import('mermaid')).default;
                const candidates = buildMermaidCandidates(code);
                if (!candidates.length) {
                    throw new Error('Empty Mermaid diagram');
                }
                mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: 'loose',
                    theme: theme === 'dark' ? 'dark' : 'default',
                });

                let renderedSvg = '';
                let lastError = null;
                let lastCandidateTried = '';
                for (let idx = 0; idx < candidates.length; idx += 1) {
                    try {
                        lastCandidateTried = candidates[idx];
                        const { svg: nextSvg } = await mermaid.render(`${renderIdRef.current}-${idx}`, lastCandidateTried);
                        const cleanedSvg = sanitizeMermaidRenderedSvg(nextSvg);
                        if (hasMermaidErrorSvg(cleanedSvg)) {
                            throw new Error('Mermaid parse error');
                        }
                        renderedSvg = cleanedSvg;
                        break;
                    } catch (candidateError) {
                        cleanupLeakedMermaidErrorArtifacts();
                        lastError = candidateError;
                    }
                }

                if (!renderedSvg) {
                    if (lastCandidateTried) {
                        console.warn('Last Mermaid candidate attempted:\n', lastCandidateTried);
                    }
                    throw lastError || new Error('Mermaid syntax error');
                }
                if (!cancelled) setSvg(renderedSvg);
            } catch (e) {
                console.warn('Mermaid render failed', e);
                cleanupLeakedMermaidErrorArtifacts();
                if (!cancelled) {
                    setSvg('');
                    setError('Unable to render Mermaid diagram. Showing source instead.');
                }
            }
        };
        render();
        return () => { cancelled = true; };
    }, [code, theme]);

    if (error || !svg) {
        return (
            <div style={{ padding: 12 }}>
                {error && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{error}</div>}
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>{normalizeMermaidCode(code)}</pre>
            </div>
        );
    }

    return (
        <div
            style={{ padding: 12, overflow: 'auto' }}
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
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
    const [editingThreadId, setEditingThreadId] = useState(null);
    const [editingThreadTitle, setEditingThreadTitle] = useState('');
    const [attachedFiles, setAttachedFiles] = useState([]);
    const [activeTab, setActiveTab] = useState('Local');
    const [editSuggestion, setEditSuggestion] = useState('');
    const [suggestOpen, setSuggestOpen] = useState(false);
    const [suggestAtMenu, setSuggestAtMenu] = useState(false);
    const [autoApprove, setAutoApprove] = useState(true);
    const [runtimePreviewFiles, setRuntimePreviewFiles] = useState({});
    const [copyPreviewStatus, setCopyPreviewStatus] = useState('idle');

    const modelDropdownRef = useRef(null);

    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const isGeneratingRef = useRef(false);
    const activeStreamAbortRef = useRef(null);
    const copyResetTimeoutRef = useRef(null);
    const latestAgentMessage = [...messages].reverse().find((msg) => msg.type === 'agent');
    const latestAwaitingApprovalAgent = [...messages]
        .reverse()
        .find((msg) => msg?.type === 'agent' && msg?.runMode === 'real' && msg?.status === 'awaiting_approval' && msg?.approvalCheckpoint?.stage === 'post_architecture');
    const previewFilesMap = { ...MOCK_FILES, ...runtimePreviewFiles };
    const suggestEditsEnabled = true;
    const canSuggestEditsInPreview = suggestEditsEnabled && Boolean(latestAwaitingApprovalAgent);
    const pipelineInProgress = isTyping || (
        latestAgentMessage &&
        (latestAgentMessage.status === 'running' || latestAgentMessage.status === 'awaiting_approval')
    );

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isTyping]);
    useEffect(() => {
        const cached = readThreadUiCache(activeThread);
        setRuntimePreviewFiles(cached?.previewFiles || {});
    }, [activeThread]);

    // Close model dropdown on outside click
    useEffect(() => {
        const handler = (e) => { if (!modelDropdownRef.current?.contains(e.target)) setModelDropdownOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    useEffect(() => {
        return () => {
            if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
        };
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
            const { data: messageRows } = await supabase.from('messages')
                .select('*')
                .eq('thread_id', activeThread)
                .order('created_at', { ascending: true });
            const { data: attachmentRows, error: attachmentError } = await supabase.from('message_attachments')
                .select('*')
                .eq('thread_id', activeThread)
                .order('created_at', { ascending: true });
            const { data: artifactRows, error: artifactError } = await supabase.from('message_artifacts')
                .select('*')
                .eq('thread_id', activeThread)
                .order('created_at', { ascending: true });

            if (cancelled) return;

            if (attachmentError) {
                console.warn('Attachment metadata load unavailable (table may not exist yet):', attachmentError);
            }
            if (artifactError) {
                console.warn('Artifact payload load unavailable (table may not exist yet):', artifactError);
            }

            if (messageRows) {
                const filesByMessageId = new Map();
                const artifactsByMessageId = new Map();
                const persistedPreviewFiles = {};
                for (const row of attachmentRows || []) {
                    if (!row?.message_id) continue;
                    if (!filesByMessageId.has(row.message_id)) filesByMessageId.set(row.message_id, []);
                    filesByMessageId.get(row.message_id).push(row.original_name);
                }
                for (const row of artifactRows || []) {
                    if (!row?.message_id) continue;
                    artifactsByMessageId.set(row.message_id, row.payload || null);
                    Object.assign(persistedPreviewFiles, row?.payload?.preview_files || row?.payload?.previewFiles || {});
                }

                // Parse the DB rows back into the frontend schema
                const formatted = messageRows.map(msg => ({
                    id: msg.id,
                    type: msg.role,
                    text: msg.content,
                    files: filesByMessageId.get(msg.id) || [],
                    persistedArtifact: artifactsByMessageId.get(msg.id) || null,
                }));
                // We ensure historical completed agent messages always have the deployment block state active
                // For simplicity in this demo, all agent messages are assumed to have reached phase 2 completion
                const withMockData = formatted.map(msg =>
                    msg.type === 'agent'
                        ? (() => {
                            const agentState = msg.persistedArtifact?.agent_state || msg.persistedArtifact?.agentState || null;
                            if (agentState && typeof agentState === 'object') {
                                return {
                                    ...msg,
                                    ...agentState,
                                    runMode: 'real',
                                };
                            }
                            return {
                                ...msg,
                                files: AGENT_FINAL.files,
                                status: 'completed',
                                phase: 2,
                                stepIndex: 99
                            };
                        })()
                        : msg
                );
                const cachedUi = readThreadUiCache(activeThread);
                const hydratedMessages = (() => {
                    if (!cachedUi?.latestRealAgent) return withMockData;
                    const lastAgentIdx = [...withMockData].map((m, idx) => ({ m, idx }))
                        .reverse()
                        .find(({ m }) => m.type === 'agent')?.idx;
                    if (lastAgentIdx == null) return withMockData;
                    return withMockData.map((m, idx) => (
                        idx === lastAgentIdx
                            ? { ...m, ...cachedUi.latestRealAgent, runMode: 'real' }
                            : m
                    ));
                })();

                setRuntimePreviewFiles({
                    ...persistedPreviewFiles,
                    ...(cachedUi?.previewFiles || {}),
                });

                setMessages(hydratedMessages.map(({ persistedArtifact, ...rest }) => rest));
                setInterfaceThreadContextFromMessages(activeThread, hydratedMessages);
                mergeThreadFileMetadata(activeThread, attachmentRows || []);
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

    const handleLogout = () => {
        clearAllInterfaceThreadContexts();
        clearAllThreadFileContexts();
        clearAllThreadUiCaches();
        logout();
        navigate('/');
    };

    const handleNewThread = () => {
        isGeneratingRef.current = false;
        setActiveThread(null);
        localStorage.removeItem('interius_active_thread');
        setMessages([]);
        setInput('');
        setAttachedFiles([]);
        setPanelMode(null);
        setPreviewFile(null);
        setRuntimePreviewFiles({});
    };

    const handleDeleteThread = async (e, id) => {
        e.stopPropagation();
        clearInterfaceThreadContext(id);
        clearThreadFileContext(id);
        clearThreadUiCache(id);
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

    const handleStopPipeline = () => {
        if (!activeStreamAbortRef.current) return;
        try {
            activeStreamAbortRef.current.abort();
        } catch {
            // no-op
        } finally {
            activeStreamAbortRef.current = null;
        }
    };

    const submitSuggestEdits = async () => {
        const suggestionText = editSuggestion.trim();
        if (!suggestionText) return;
        const prompt = `Please apply the following edits to ${previewFile}:\n\n${suggestionText}`;
        const latestPausedRealAgent = latestAwaitingApprovalAgent;
        setEditSuggestion('');
        setSuggestOpen(false);
        if (latestPausedRealAgent?.id) {
            setMessages(curr => curr.map(msg => (
                msg.id === latestPausedRealAgent.id
                    ? {
                        ...msg,
                        approvalCheckpoint: {
                            ...(msg.approvalCheckpoint || {}),
                            prompt: `${msg.approvalCheckpoint?.prompt || ''}\n\nReviewer / user requested edits before code generation:\n${suggestionText}`.trim(),
                            editInstructions: suggestionText,
                        },
                        reviewUpdates: [
                            ...(Array.isArray(msg.reviewUpdates) ? msg.reviewUpdates.slice(-4) : []),
                            {
                                id: `${Date.now()}-precode-edit`,
                                kind: 'revision',
                                text: `Applying requested edits before code generation${previewFile ? ` (focus: ${previewFile})` : ''}.`,
                            },
                        ],
                    }
                    : msg
            )));
            setPanelMode(null);
            setPreviewFile(null);
            await approvePhase1(latestPausedRealAgent.id);
            return;
        }
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

    const upsertRuntimePreviewFiles = (entries, threadIdOverride = null) => {
        if (!entries) return;
        const nextMap = buildPreviewMapFromEntries(entries);

        if (!Object.keys(nextMap).length) return;
        setRuntimePreviewFiles((curr) => {
            const merged = { ...curr, ...nextMap };
            const cacheThreadId = threadIdOverride || activeThread;
            if (cacheThreadId) {
                writeThreadUiCache(cacheThreadId, { previewFiles: merged });
            }
            return merged;
        });
    };

    const buildFileMapFromArtifactFiles = (files = [], dependencies = []) => {
        const map = {};
        for (const file of files) {
            if (!file?.path || typeof file?.content !== 'string') continue;
            map[file.path] = file.content;
        }
        if (Array.isArray(dependencies) && dependencies.length) {
            map['requirements.txt'] = `${dependencies.join('\n')}\n`;
        }
        return map;
    };

    const beginEditThreadTitle = (e, thread) => {
        e.stopPropagation();
        setEditingThreadId(thread.id);
        setEditingThreadTitle(thread.title || '');
    };

    const cancelEditThreadTitle = (e) => {
        e?.stopPropagation?.();
        setEditingThreadId(null);
        setEditingThreadTitle('');
    };

    const saveThreadTitle = async (e, threadId) => {
        e?.stopPropagation?.();
        const nextTitle = editingThreadTitle.trim();
        if (!nextTitle) {
            cancelEditThreadTitle();
            return;
        }

        const previousTitle = threads.find((t) => t.id === threadId)?.title;
        setThreads((curr) => curr.map((t) => (t.id === threadId ? { ...t, title: nextTitle } : t)));

        const { error } = await supabase
            .from('threads')
            .update({ title: nextTitle })
            .eq('id', threadId);

        if (error) {
            console.error('Failed to rename thread', error);
            if (previousTitle != null) {
                setThreads((curr) => curr.map((t) => (t.id === threadId ? { ...t, title: previousTitle } : t)));
            }
        }

        cancelEditThreadTitle();
    };

    const saveMessageAttachmentMetadata = async (threadId, messageId, files, userId) => {
        if (!threadId || !messageId || !userId || !files?.length) return;

        const rows = files.map((file) => ({
            thread_id: threadId,
            message_id: messageId,
            user_id: userId,
            original_name: file.name,
            mime_type: file.type || null,
            size_bytes: file.size ?? null,
        }));

        const { error } = await supabase.from('message_attachments').insert(rows);
        if (error) {
            console.warn('Failed to persist attachment metadata', error);
        }
    };

    const buildThreadTitleSeed = (threadId, promptText) => {
        const prompt = (promptText || '').trim();
        const summaries = getThreadFileContextSummaries(threadId).slice(-3);
        if (!summaries.length) return prompt;

        const fileContext = summaries.map((f) => {
            const excerpt = (f.text_excerpt || '').trim();
            return excerpt
                ? `${f.filename}: ${excerpt}`
                : `${f.filename} (${f.mime_type || 'unknown type'})`;
        }).join('\n');

        return [
            prompt || 'Build from attached requirements',
            fileContext,
        ].join('\n');
    };

    const shouldAutoRenameBuildThread = (threadId, hadExistingBuild) => {
        if (!threadId) return false;
        if (!hadExistingBuild) return true;
        const currentTitle = (threads.find((t) => t.id === threadId)?.title || '').trim().toLowerCase();
        if (!currentTitle) return true;
        return [
            'new thread',
            'new discussion',
            'hello',
            'hi',
            'good day',
            'hey',
        ].includes(currentTitle);
    };

    const autoRenameThreadFromBuildPrompt = async (threadId, promptText) => {
        if (!threadId) return;
        try {
            const previousTitle = threads.find((t) => t.id === threadId)?.title;
            const titleSeed = buildThreadTitleSeed(threadId, promptText);
            if (!titleSeed.trim()) return;
            const nextTitle = (await generateThreadTitle(titleSeed))?.trim();

            if (!nextTitle || nextTitle === previousTitle) return;

            setThreads((curr) => curr.map((t) => (t.id === threadId ? { ...t, title: nextTitle } : t)));

            const { error } = await supabase
                .from('threads')
                .update({ title: nextTitle })
                .eq('id', threadId);

            if (error) {
                console.error('Failed to auto-rename thread from build prompt', error);
                if (previousTitle != null) {
                    setThreads((curr) => curr.map((t) => (t.id === threadId ? { ...t, title: previousTitle } : t)));
                }
            }
        } catch (error) {
            console.error('Failed to auto-rename thread from build prompt', error);
        }
    };

    const sendMessage = async (text) => {
        if ((!text && attachedFiles.length === 0) || isGeneratingRef.current || !user) return;

        isGeneratingRef.current = true;
        const filesForThisSend = [...attachedFiles];
        const userMessageContent = text || (filesForThisSend.length ? 'Attached context files.' : '');

        const sourceThreadId = activeThread;
        let threadId = activeThread;
        const hadExistingBuild = messages.some((m) => m.type === 'agent');
        let createdThreadThisSend = false;

        // Create new thread if none active
        if (!threadId) {
            const generatedTitle = await generateThreadTitle(text || 'Context files upload');
            const { data, error } = await supabase.from('threads').insert({
                user_id: user.id,
                title: generatedTitle
            }).select().single();

            if (!error && data) {
                threadId = data.id;
                createdThreadThisSend = true;
                setThreads(t => [data, ...t]);
                setActiveThread(threadId);
                localStorage.setItem('interius_active_thread', threadId);
            } else {
                console.error("Failed to create thread", error);
                return;
            }
        }

        // Add user message to UI
        setMessages(m => [...m, { type: 'user', text: userMessageContent, files: filesForThisSend.map(f => f.name) }]);
        if (text) {
            appendInterfaceThreadContext(threadId, { role: 'user', content: text });
        }
        setAttachedFiles([]);
        setIsTyping(true);

        // Keep file context separate from chat text history. This is reused later if the user
        // triggers a build in the same thread.
        if (filesForThisSend.length > 0) {
            await ingestThreadFiles(threadId, filesForThisSend);
        }

        let savedUserMessageId = null;
        if (userMessageContent) {
            // Save user message to DB
            const { data: savedUserMessage, error: saveMessageError } = await supabase.from('messages').insert({
                thread_id: threadId,
                user_id: user.id,
                role: 'user',
                content: userMessageContent
            }).select('id').single();
            if (saveMessageError) {
                console.warn('Failed to persist user message', saveMessageError);
            } else {
                savedUserMessageId = savedUserMessage?.id || null;
            }
        }

        if (filesForThisSend.length > 0 && savedUserMessageId) {
            await saveMessageAttachmentMetadata(threadId, savedUserMessageId, filesForThisSend, user.id);
        }

        let interfaceDecision = null;
        try {
            const cachedContext = getInterfaceThreadContext(threadId);
            const fallbackUiContext = messages
                .map((m) => ({ role: m.type, content: m.text }))
                .filter((m) => ['user', 'assistant', 'agent'].includes(m.role) && m.content);
            interfaceDecision = await routeChatIntent(text, {
                recentMessages: cachedContext.length ? cachedContext : fallbackUiContext,
                attachmentSummaries: getThreadFileContextSummaries(threadId),
            });
        } catch (error) {
            console.warn('Interface routing unavailable, falling back to mock pipeline:', error);
        }

        if (interfaceDecision?.should_trigger_pipeline === false) {
            const assistantReply = (interfaceDecision.assistant_reply || 'Happy to help.').trim();

            setIsTyping(false);
            setMessages(m => [...m, { type: 'assistant', text: assistantReply }]);
            appendInterfaceThreadContext(threadId, { role: 'assistant', content: assistantReply });

            await supabase.from('messages').insert({
                thread_id: threadId,
                user_id: user.id,
                role: 'assistant',
                content: assistantReply
            });

            isGeneratingRef.current = false;
            setPanelMode(null);
            inputRef.current?.focus();
            return;
        }

        if (interfaceDecision?.should_trigger_pipeline === true) {
            // If this thread already contains a previous build, fork into a new thread so
            // artifacts/code from the earlier run remain intact in the original thread.
            if (hadExistingBuild && !createdThreadThisSend && sourceThreadId && threadId === sourceThreadId) {
                try {
                    const forkTitleSeed = buildThreadTitleSeed(sourceThreadId, text || userMessageContent || '');
                    const forkTitle = await generateThreadTitle(forkTitleSeed || text || 'New build');
                    const { data: forkThread, error: forkThreadError } = await supabase
                        .from('threads')
                        .insert({
                            user_id: user.id,
                            title: forkTitle || 'New build',
                        })
                        .select()
                        .single();

                    if (forkThreadError || !forkThread) {
                        console.warn('Failed to auto-fork thread for a new build; continuing in current thread.', forkThreadError);
                    } else {
                        const previousThreadId = threadId;
                        const nextThreadId = forkThread.id;

                        if (savedUserMessageId) {
                            const { error: moveUserMsgError } = await supabase
                                .from('messages')
                                .update({ thread_id: nextThreadId })
                                .eq('id', savedUserMessageId);
                            if (moveUserMsgError) {
                                console.warn('Failed to move user build prompt to forked thread', moveUserMsgError);
                            }

                            if (filesForThisSend.length > 0) {
                                const { error: moveAttachmentsError } = await supabase
                                    .from('message_attachments')
                                    .update({ thread_id: nextThreadId })
                                    .eq('message_id', savedUserMessageId);
                                if (moveAttachmentsError) {
                                    console.warn('Failed to move attachment metadata to forked thread', moveAttachmentsError);
                                }
                            }
                        } else if (userMessageContent) {
                            const { data: movedUserMessage, error: recreateUserMessageError } = await supabase
                                .from('messages')
                                .insert({
                                    thread_id: nextThreadId,
                                    user_id: user.id,
                                    role: 'user',
                                    content: userMessageContent,
                                })
                                .select('id')
                                .single();
                            if (recreateUserMessageError) {
                                console.warn('Failed to persist user message in forked thread', recreateUserMessageError);
                            } else {
                                savedUserMessageId = movedUserMessage?.id || savedUserMessageId;
                                if (filesForThisSend.length > 0 && savedUserMessageId) {
                                    await saveMessageAttachmentMetadata(nextThreadId, savedUserMessageId, filesForThisSend, user.id);
                                }
                            }
                        }

                        copyInterfaceThreadContext(previousThreadId, nextThreadId);
                        copyThreadFileContext(previousThreadId, nextThreadId);

                        threadId = nextThreadId;
                        createdThreadThisSend = true;
                        setThreads((curr) => [forkThread, ...curr]);
                        setActiveThread(nextThreadId);
                        localStorage.setItem('interius_active_thread', nextThreadId);
                        setMessages([
                            {
                                type: 'user',
                                text: userMessageContent,
                                files: filesForThisSend.map((f) => f.name),
                            }
                        ]);
                    }
                } catch (forkError) {
                    console.warn('Failed to auto-fork thread for a new build; continuing in current thread.', forkError);
                }
            }

            const assistantReply = (interfaceDecision.assistant_reply || '').trim();
            const buildContextFiles = getThreadBuildContextFiles(threadId);
            const shouldAutoRename = shouldAutoRenameBuildThread(threadId, hadExistingBuild);

            if (shouldAutoRename) {
                void autoRenameThreadFromBuildPrompt(threadId, text || userMessageContent || '');
            }

            if (assistantReply) {
                setMessages(m => [...m, { type: 'assistant', text: assistantReply }]);
                appendInterfaceThreadContext(threadId, { role: 'assistant', content: assistantReply });

                await supabase.from('messages').insert({
                    thread_id: threadId,
                    user_id: user.id,
                    role: 'assistant',
                    content: assistantReply
                });
            }

            {
                const realAgentMsgId = Date.now();
                let streamCompleted = false;
                let streamStarted = false;
                let streamAwaitingApproval = false;
                let streamFinalSummary = '';
                let streamGeneratedFileMap = {};
                let streamGeneratedFileList = [];
                let streamPreviewFiles = {};
                let streamArtifactDocFiles = [];
                let streamStageTimings = {};
                let streamReviewUpdates = [];
                let streamRequirementsArtifact = null;
                let streamArchitectureArtifact = null;
                let persistedRealAgentDbId = null;

                setMessages(m => [...m, {
                    id: realAgentMsgId,
                    type: 'agent',
                    isStreaming: true,
                    phase: 1,
                    stepIndex: 0,
                    status: 'running',
                    runMode: 'real',
                    files: [],
                    generatedFileMap: {},
                    reviewUpdates: [],
                }]);

                const setAgentProgress = (patch) => {
                    setMessages((curr) => curr.map((msg) => (
                        msg.id === realAgentMsgId ? { ...msg, ...patch } : msg
                    )));
                    writeThreadUiCache(threadId, {
                        latestRealAgent: {
                            ...patch,
                            runMode: 'real',
                        }
                    });
                };

                try {
                    const cachedContext = getInterfaceThreadContext(threadId);
                    const fallbackUiContext = messages
                        .map((m) => ({ role: m.type, content: m.text }))
                        .filter((m) => ['user', 'assistant', 'agent'].includes(m.role) && m.content);
                    const streamAbortController = new AbortController();
                    activeStreamAbortRef.current = streamAbortController;

                    await streamThreadChatGeneration({
                        threadId,
                        prompt: text,
                        recentMessages: cachedContext.length ? cachedContext : fallbackUiContext,
                        attachmentSummaries: getThreadFileContextSummaries(threadId),
                        threadContextFiles: buildContextFiles,
                        stopAfterArchitecture: TEMP_STOP_AFTER_ARCHITECTURE || !autoApprove,
                        signal: streamAbortController.signal,
                        onEvent: (event) => {
                            streamStarted = true;
                            const status = event?.status;

                            if (status === 'stage_started') {
                                const stage = event.stage;
                                streamStageTimings = {
                                    ...streamStageTimings,
                                    [stage]: {
                                        ...(streamStageTimings[stage] || {}),
                                        startedAt: Date.now(),
                                    },
                                };
                                if (stage === 'requirements') {
                                    setAgentProgress({ phase: 1, stepIndex: 0, isStreaming: true, status: 'running', stageTimings: streamStageTimings });
                                } else if (stage === 'architecture') {
                                    setAgentProgress({ phase: 1, stepIndex: 1, isStreaming: true, status: 'running', stageTimings: streamStageTimings });
                                } else if (stage === 'implementer') {
                                    setAgentProgress({ phase: 2, stepIndex: 0, isStreaming: true, status: 'running', stageTimings: streamStageTimings });
                                } else if (stage === 'reviewer' || stage === 'tester') {
                                    setAgentProgress({ phase: 2, stepIndex: 1, isStreaming: true, status: 'running', stageTimings: streamStageTimings });
                                }
                                return;
                            }

                            if (status === 'stage_completed') {
                                const stage = event.stage;
                                const endAt = Date.now();
                                const startAt = streamStageTimings[stage]?.startedAt || endAt;
                                streamStageTimings = {
                                    ...streamStageTimings,
                                    [stage]: {
                                        ...(streamStageTimings[stage] || {}),
                                        startedAt: startAt,
                                        completedAt: endAt,
                                        durationMs: endAt - startAt,
                                    },
                                };
                                if (stage === 'requirements') {
                                    setAgentProgress({ phase: 1, stepIndex: 1, stageTimings: streamStageTimings });
                                } else if (stage === 'architecture') {
                                    setAgentProgress({ phase: 2, stepIndex: 0, stageTimings: streamStageTimings });
                                } else if (stage === 'implementer') {
                                    setAgentProgress({ phase: 2, stepIndex: 1, stageTimings: streamStageTimings });
                                } else if (stage === 'reviewer' || stage === 'tester') {
                                    setAgentProgress({ phase: 2, stepIndex: 2, stageTimings: streamStageTimings });
                                }
                                return;
                            }

                            if (status === 'artifact_requirements') {
                                streamRequirementsArtifact = event.artifact || streamRequirementsArtifact;
                                if (!streamArtifactDocFiles.includes('Requirements Document.md')) {
                                    streamArtifactDocFiles.push('Requirements Document.md');
                                }
                                streamPreviewFiles = {
                                    ...streamPreviewFiles,
                                    ...buildPreviewMapFromEntries(event.preview_file),
                                };
                                upsertRuntimePreviewFiles(event.preview_file, threadId);
                                return;
                            }

                            if (status === 'artifact_architecture') {
                                streamArchitectureArtifact = event.artifact || streamArchitectureArtifact;
                                if (!streamArtifactDocFiles.includes('Architecture Diagram.mmd') && event.diagram_file?.path) {
                                    streamArtifactDocFiles.push(event.diagram_file.path);
                                }
                                streamPreviewFiles = {
                                    ...streamPreviewFiles,
                                    ...buildPreviewMapFromEntries([event.preview_file, event.diagram_file].filter(Boolean)),
                                };
                                upsertRuntimePreviewFiles(
                                    [event.preview_file, event.diagram_file].filter(Boolean),
                                    threadId
                                );
                                return;
                            }

                            if (status === 'artifact_files') {
                                const fileMap = buildFileMapFromArtifactFiles(event.files || [], event.dependencies || []);
                                streamGeneratedFileMap = { ...streamGeneratedFileMap, ...fileMap };
                                streamGeneratedFileList = Object.keys(streamGeneratedFileMap).filter((p) => p !== 'requirements.txt');
                                streamPreviewFiles = {
                                    ...streamPreviewFiles,
                                    ...buildPreviewMapFromEntries(Object.entries(fileMap).map(([path, content]) => ({ path, content }))),
                                };
                                upsertRuntimePreviewFiles(
                                    Object.entries(fileMap).map(([path, content]) => ({ path, content }))
                                , threadId);
                                setAgentProgress({
                                    files: streamGeneratedFileList,
                                    generatedFileMap: streamGeneratedFileMap,
                                    phase: 2,
                                    stepIndex: 1,
                                    stageTimings: streamStageTimings,
                                });
                                return;
                            }

                            if (status === 'review_update') {
                                const kind = event.kind || 'info';
                                const affectedFiles = Array.isArray(event.affected_files)
                                    ? event.affected_files.filter(Boolean)
                                    : [];
                                const artifact = event.artifact || {};
                                let noteText = (event.message || '').trim();

                                if (!noteText && kind === 'tests') {
                                    const failures = Array.isArray(artifact.failures) ? artifact.failures.length : 0;
                                    noteText = failures
                                        ? `Smoke tests found ${failures} issue(s).`
                                        : 'Smoke tests completed.';
                                }

                                if (affectedFiles.length && kind === 'revision') {
                                    noteText = `${noteText} (${affectedFiles.join(', ')})`.trim();
                                }

                                if (noteText) {
                                    const note = {
                                        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                                        kind,
                                        text: noteText,
                                    };
                                    streamReviewUpdates = [...streamReviewUpdates.slice(-5), note];
                                    setAgentProgress({
                                        reviewUpdates: streamReviewUpdates,
                                        stageTimings: streamStageTimings,
                                    });
                                }
                                return;
                            }

                            if (status === 'awaiting_approval') {
                                streamAwaitingApproval = true;
                                streamRequirementsArtifact = event.requirements_artifact || streamRequirementsArtifact;
                                streamArchitectureArtifact = event.architecture_artifact || streamArchitectureArtifact;
                                const approvalText =
                                    (event.summary || '').trim() ||
                                    'Interius prepared requirements and architecture artifacts for your review.';
                                const approvalCheckpoint = {
                                    stage: 'post_architecture',
                                    prompt: text,
                                    requirementsArtifact: streamRequirementsArtifact,
                                    architectureArtifact: streamArchitectureArtifact,
                                };

                                setAgentProgress({
                                    isStreaming: false,
                                    status: 'awaiting_approval',
                                    phase: 1,
                                    stepIndex: 99,
                                    text: approvalText,
                                    runMode: 'real',
                                    stageTimings: streamStageTimings,
                                    approvalCheckpoint,
                                    files: [...new Set(streamArtifactDocFiles)],
                                    generatedFileMap: streamGeneratedFileMap,
                                    reviewUpdates: streamReviewUpdates,
                                });

                                return;
                            }

                            if (status === 'completed') {
                                streamCompleted = true;
                                const completedFiles = (event.files || [])
                                    .map((f) => f?.path)
                                    .filter(Boolean);
                                if (completedFiles.length) {
                                    streamGeneratedFileList = completedFiles;
                                }
                                const finalArtifactFiles = [...new Set([
                                    ...streamArtifactDocFiles,
                                    ...streamGeneratedFileList,
                                ])];
                                streamFinalSummary =
                                    (event.summary || '').trim() ||
                                    (event.message || '').trim() ||
                                    AGENT_FINAL.text;

                                setAgentProgress({
                                    isStreaming: false,
                                    status: 'completed',
                                    phase: 2,
                                    stepIndex: 99,
                                    text: streamFinalSummary,
                                    files: finalArtifactFiles,
                                    generatedFileMap: streamGeneratedFileMap,
                                    runMode: 'real',
                                    stageTimings: streamStageTimings,
                                    reviewUpdates: streamReviewUpdates,
                                });
                                writeThreadUiCache(threadId, {
                                    latestRealAgent: {
                                        isStreaming: false,
                                        status: 'completed',
                                        phase: 2,
                                        stepIndex: 99,
                                        text: streamFinalSummary,
                                        files: finalArtifactFiles,
                                        generatedFileMap: streamGeneratedFileMap,
                                        runMode: 'real',
                                        stageTimings: streamStageTimings,
                                        reviewUpdates: streamReviewUpdates,
                                    }
                                });
                                return;
                            }

                            if (status === 'error') {
                                throw new Error(event.message || 'Pipeline failed');
                            }
                        }
                    });

                    if (!streamCompleted && !streamAwaitingApproval) {
                        throw new Error('Stream ended before completion');
                    }

                    setIsTyping(false);

                    if (streamAwaitingApproval) {
                        const approvalText = 'Requirements and architecture are ready for your approval.';
                        const approvalCheckpoint = {
                            stage: 'post_architecture',
                            prompt: text,
                            requirementsArtifact: streamRequirementsArtifact,
                            architectureArtifact: streamArchitectureArtifact,
                        };

                        const { data: savedPausedAgentMessage, error: savePausedAgentError } = await supabase.from('messages').insert({
                            thread_id: threadId,
                            user_id: user.id,
                            role: 'agent',
                            content: approvalText
                        }).select('id').single();
                        if (savePausedAgentError) {
                            console.warn('Failed to persist HITL checkpoint message', savePausedAgentError);
                        } else if (savedPausedAgentMessage?.id) {
                            persistedRealAgentDbId = savedPausedAgentMessage.id;
                            await persistMessageArtifactBundle({
                                threadId,
                                messageId: savedPausedAgentMessage.id,
                                userId: user.id,
                                agentState: {
                                    isStreaming: false,
                                    status: 'awaiting_approval',
                                    phase: 1,
                                    stepIndex: 99,
                                    text: approvalText,
                                    files: [...new Set(streamArtifactDocFiles)],
                                    generatedFileMap: streamGeneratedFileMap,
                                    runMode: 'real',
                                    stageTimings: streamStageTimings,
                                    approvalCheckpoint,
                                    reviewUpdates: streamReviewUpdates,
                                    dbMessageId: savedPausedAgentMessage.id,
                                },
                                previewFiles: streamPreviewFiles,
                            });
                            setMessages((curr) => curr.map((msg) => (
                                msg.id === realAgentMsgId
                                    ? { ...msg, dbMessageId: savedPausedAgentMessage.id, approvalCheckpoint, text: approvalText }
                                    : msg
                            )));
                        }
                        appendInterfaceThreadContext(threadId, { role: 'agent', content: approvalText });
                        isGeneratingRef.current = false;
                        setPanelMode(null);
                        inputRef.current?.focus();
                        return;
                    }

                    const { data: savedAgentMessage, error: saveAgentError } = await supabase.from('messages').insert({
                        thread_id: threadId,
                        user_id: user.id,
                        role: 'agent',
                        content: streamFinalSummary || AGENT_FINAL.text
                    }).select('id').single();
                    if (saveAgentError) {
                        console.warn('Failed to persist real agent message', saveAgentError);
                    } else if (savedAgentMessage?.id) {
                        await persistMessageArtifactBundle({
                            threadId,
                            messageId: savedAgentMessage.id,
                            userId: user.id,
                                agentState: {
                                    isStreaming: false,
                                    status: 'completed',
                                    phase: 2,
                                    stepIndex: 99,
                                    text: streamFinalSummary || AGENT_FINAL.text,
                                    files: [...new Set([...streamArtifactDocFiles, ...streamGeneratedFileList])],
                                    generatedFileMap: streamGeneratedFileMap,
                                    runMode: 'real',
                                    stageTimings: streamStageTimings,
                                    reviewUpdates: streamReviewUpdates,
                                },
                            previewFiles: streamPreviewFiles,
                        });
                    }
                    appendInterfaceThreadContext(threadId, { role: 'agent', content: streamFinalSummary || AGENT_FINAL.text });

                    isGeneratingRef.current = false;
                    setPanelMode(null);
                    inputRef.current?.focus();
                    return;
                } catch (streamError) {
                    const isAbort = streamError?.name === 'AbortError' || /aborted|abort/i.test(String(streamError?.message || ''));
                    if (isAbort) {
                        setIsTyping(false);
                        const stoppedText = 'Interius stopped the pipeline at your request.';
                        setMessages((curr) => curr.map((msg) => (
                            msg.id === realAgentMsgId
                                ? {
                                    ...msg,
                                    isStreaming: false,
                                    status: 'completed',
                                    text: stoppedText,
                                    runMode: 'real',
                                    reviewUpdates: [
                                        ...(Array.isArray(msg.reviewUpdates) ? msg.reviewUpdates.slice(-4) : []),
                                        { id: `${Date.now()}-stopped`, kind: 'revision', text: 'Pipeline stopped by user.' },
                                    ],
                                }
                                : msg
                        )));
                        writeThreadUiCache(threadId, {
                            latestRealAgent: {
                                isStreaming: false,
                                status: 'completed',
                                text: stoppedText,
                                runMode: 'real',
                            }
                        });
                        isGeneratingRef.current = false;
                        setPanelMode(null);
                        inputRef.current?.focus();
                        return;
                    }
                    console.warn('Real chat generation stream unavailable, falling back to mock pipeline:', streamError);
                    const cacheAfterFailure = readThreadUiCache(threadId);
                    const hasRealArtifacts = Boolean(cacheAfterFailure?.previewFiles && Object.keys(cacheAfterFailure.previewFiles).length);
                    if (streamStarted && !hasRealArtifacts) {
                        setIsTyping(false);
                        const errorText = 'Interius started the real generation pipeline, but it stopped before artifacts were produced.';
                        setMessages((curr) => curr.map((msg) => (
                            msg.id === realAgentMsgId
                                ? {
                                    ...msg,
                                    isStreaming: false,
                                    status: 'completed',
                                    text: errorText,
                                    runMode: 'real',
                                }
                                : msg
                        )));
                        writeThreadUiCache(threadId, {
                            latestRealAgent: {
                                isStreaming: false,
                                status: 'completed',
                                    text: errorText,
                                    runMode: 'real',
                                    stageTimings: streamStageTimings,
                                }
                        });
                        const { data: savedFailedRealAgent, error: saveFailedRealAgentError } = await supabase.from('messages').insert({
                            thread_id: threadId,
                            user_id: user.id,
                            role: 'agent',
                            content: errorText
                        }).select('id').single();
                        if (saveFailedRealAgentError) {
                            console.warn('Failed to persist real-stream error message', saveFailedRealAgentError);
                        } else if (savedFailedRealAgent?.id) {
                            await persistMessageArtifactBundle({
                                threadId,
                                messageId: savedFailedRealAgent.id,
                                userId: user.id,
                                agentState: {
                                    isStreaming: false,
                                    status: 'completed',
                                    text: errorText,
                                    runMode: 'real',
                                    stageTimings: streamStageTimings,
                                },
                                previewFiles: {},
                            });
                        }
                        appendInterfaceThreadContext(threadId, { role: 'agent', content: errorText });
                        isGeneratingRef.current = false;
                        setPanelMode(null);
                        inputRef.current?.focus();
                        return;
                    }
                    if (hasRealArtifacts) {
                        setIsTyping(false);
                        const partialText = 'Interius generated partial artifacts, but the pipeline stopped before completion.';
                        setMessages((curr) => curr.map((msg) => (
                            msg.id === realAgentMsgId
                                ? {
                                    ...msg,
                                    isStreaming: false,
                                    status: 'completed',
                                    text: partialText,
                                    runMode: 'real',
                                }
                                : msg
                        )));
                        writeThreadUiCache(threadId, {
                            latestRealAgent: {
                                isStreaming: false,
                                status: 'completed',
                                text: partialText,
                                runMode: 'real',
                            }
                        });
                        const { data: savedPartialAgent, error: savePartialError } = await supabase.from('messages').insert({
                            thread_id: threadId,
                            user_id: user.id,
                            role: 'agent',
                            content: partialText
                        }).select('id').single();
                        if (savePartialError) {
                            console.warn('Failed to persist partial real agent message', savePartialError);
                        } else if (savedPartialAgent?.id) {
                            await persistMessageArtifactBundle({
                                threadId,
                                messageId: savedPartialAgent.id,
                                userId: user.id,
                                agentState: {
                                    ...(cacheAfterFailure?.latestRealAgent || {}),
                                    isStreaming: false,
                                    status: 'completed',
                                    text: partialText,
                                    runMode: 'real',
                                },
                                previewFiles: cacheAfterFailure?.previewFiles || {},
                            });
                        }
                        appendInterfaceThreadContext(threadId, { role: 'agent', content: partialText });
                        isGeneratingRef.current = false;
                        setPanelMode(null);
                        inputRef.current?.focus();
                        return;
                    }
                    setMessages((curr) => curr.filter((msg) => msg.id !== realAgentMsgId));
                } finally {
                    activeStreamAbortRef.current = null;
                }
            }
        }

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
                ...AGENT_FINAL,
                text: AGENT_FINAL.text
            };

            setMessages(curr => curr.map(msg => msg.id === msgId ? { ...msg, ...finalPayload } : msg));

            // Save final agent message to DB
            await supabase.from('messages').insert({
                thread_id: threadId,
                user_id: user.id,
                role: 'agent',
                content: AGENT_FINAL.text
            });
            appendInterfaceThreadContext(threadId, { role: 'agent', content: AGENT_FINAL.text });

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
        const targetMsg = messages.find((m) => m.id === msgId);
        const checkpoint = targetMsg?.approvalCheckpoint;
        if (targetMsg?.runMode === 'real' && checkpoint?.stage === 'post_architecture' && activeThread) {
            isGeneratingRef.current = true;
            setIsTyping(true);

            let streamCompleted = false;
            let streamFinalSummary = targetMsg?.text || '';
            let streamGeneratedFileMap = { ...(targetMsg?.generatedFileMap || {}) };
            let streamGeneratedFileList = Object.keys(streamGeneratedFileMap).filter((p) => p !== 'requirements.txt');
            let streamStageTimings = { ...(targetMsg?.stageTimings || {}) };
            let streamReviewUpdates = Array.isArray(targetMsg?.reviewUpdates) ? [...targetMsg.reviewUpdates] : [];
            let streamPreviewFiles = buildPreviewMapFromEntries(
                Object.entries(streamGeneratedFileMap).map(([path, content]) => ({ path, content }))
            );
            let streamArtifactDocFiles = Array.isArray(targetMsg?.files)
                ? targetMsg.files.filter((f) => typeof f === 'string' && (f.endsWith('.md') || f.endsWith('.mmd')))
                : [];

            setMessages(curr => curr.map(msg => msg.id === msgId ? {
                ...msg,
                isStreaming: true,
                status: 'running',
                phase: 2,
                stepIndex: 0,
                runMode: 'real',
            } : msg));

            try {
                const streamAbortController = new AbortController();
                activeStreamAbortRef.current = streamAbortController;
                await streamThreadChatGeneration({
                    threadId: activeThread,
                    prompt: checkpoint.prompt || '',
                    recentMessages: getInterfaceThreadContext(activeThread),
                    attachmentSummaries: [],
                    threadContextFiles: [],
                    stopAfterArchitecture: false,
                    resumeFromStage: 'post_architecture',
                    approvedRequirementsArtifact: checkpoint.requirementsArtifact || null,
                    approvedArchitectureArtifact: checkpoint.architectureArtifact || null,
                    signal: streamAbortController.signal,
                    onEvent: (event) => {
                        const status = event?.status;

                        if (status === 'stage_started') {
                            const stage = event.stage;
                            streamStageTimings = {
                                ...streamStageTimings,
                                [stage]: {
                                    ...(streamStageTimings[stage] || {}),
                                    startedAt: Date.now(),
                                },
                            };
                            if (stage === 'implementer') {
                                setMessages(curr => curr.map(msg => msg.id === msgId ? { ...msg, phase: 2, stepIndex: 0, isStreaming: true, status: 'running', stageTimings: streamStageTimings } : msg));
                            } else if (stage === 'reviewer' || stage === 'tester') {
                                setMessages(curr => curr.map(msg => msg.id === msgId ? { ...msg, phase: 2, stepIndex: 1, isStreaming: true, status: 'running', stageTimings: streamStageTimings } : msg));
                            }
                            return;
                        }

                        if (status === 'stage_completed') {
                            const stage = event.stage;
                            const endAt = Date.now();
                            const startAt = streamStageTimings[stage]?.startedAt || endAt;
                            streamStageTimings = {
                                ...streamStageTimings,
                                [stage]: {
                                    ...(streamStageTimings[stage] || {}),
                                    startedAt: startAt,
                                    completedAt: endAt,
                                    durationMs: endAt - startAt,
                                },
                            };
                            if (stage === 'implementer') {
                                setMessages(curr => curr.map(msg => msg.id === msgId ? { ...msg, phase: 2, stepIndex: 1, stageTimings: streamStageTimings } : msg));
                            } else if (stage === 'reviewer' || stage === 'tester') {
                                setMessages(curr => curr.map(msg => msg.id === msgId ? { ...msg, phase: 2, stepIndex: 2, stageTimings: streamStageTimings } : msg));
                            }
                            return;
                        }

                        if (status === 'artifact_files') {
                            const fileMap = buildFileMapFromArtifactFiles(event.files || [], event.dependencies || []);
                            streamGeneratedFileMap = { ...streamGeneratedFileMap, ...fileMap };
                            streamGeneratedFileList = Object.keys(streamGeneratedFileMap).filter((p) => p !== 'requirements.txt');
                            streamPreviewFiles = {
                                ...streamPreviewFiles,
                                ...buildPreviewMapFromEntries(Object.entries(fileMap).map(([path, content]) => ({ path, content }))),
                            };
                            upsertRuntimePreviewFiles(Object.entries(fileMap).map(([path, content]) => ({ path, content })), activeThread);
                            setMessages(curr => curr.map(msg => msg.id === msgId ? {
                                ...msg,
                                files: [...new Set([...streamArtifactDocFiles, ...streamGeneratedFileList])],
                                generatedFileMap: streamGeneratedFileMap,
                                phase: 2,
                                stepIndex: 1,
                                stageTimings: streamStageTimings,
                            } : msg));
                            return;
                        }

                        if (status === 'review_update') {
                            const kind = event.kind || 'info';
                            const affectedFiles = Array.isArray(event.affected_files) ? event.affected_files.filter(Boolean) : [];
                            let noteText = (event.message || '').trim();
                            if (affectedFiles.length && kind === 'revision') {
                                noteText = `${noteText} (${affectedFiles.join(', ')})`.trim();
                            }
                            if (noteText) {
                                const note = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind, text: noteText };
                                streamReviewUpdates = [...streamReviewUpdates.slice(-5), note];
                                setMessages(curr => curr.map(msg => msg.id === msgId ? { ...msg, reviewUpdates: streamReviewUpdates } : msg));
                            }
                            return;
                        }

                        if (status === 'completed') {
                            streamCompleted = true;
                            const completedFiles = (event.files || []).map((f) => f?.path).filter(Boolean);
                            if (completedFiles.length) streamGeneratedFileList = completedFiles;
                            streamFinalSummary =
                                (event.summary || '').trim() ||
                                (event.message || '').trim() ||
                                AGENT_FINAL.text;
                            const finalFiles = [...new Set([...streamArtifactDocFiles, ...streamGeneratedFileList])];
                            setMessages(curr => curr.map(msg => msg.id === msgId ? {
                                ...msg,
                                isStreaming: false,
                                status: 'completed',
                                phase: 2,
                                stepIndex: 99,
                                text: streamFinalSummary,
                                files: finalFiles,
                                generatedFileMap: streamGeneratedFileMap,
                                runMode: 'real',
                                stageTimings: streamStageTimings,
                                reviewUpdates: streamReviewUpdates,
                                approvalCheckpoint: null,
                            } : msg));
                            writeThreadUiCache(activeThread, {
                                latestRealAgent: {
                                    isStreaming: false,
                                    status: 'completed',
                                    phase: 2,
                                    stepIndex: 99,
                                    text: streamFinalSummary,
                                    files: finalFiles,
                                    generatedFileMap: streamGeneratedFileMap,
                                    runMode: 'real',
                                    stageTimings: streamStageTimings,
                                    reviewUpdates: streamReviewUpdates,
                                }
                            });
                            return;
                        }

                        if (status === 'error') {
                            throw new Error(event.message || 'Pipeline failed');
                        }
                    },
                });

                if (!streamCompleted) throw new Error('Resume stream ended before completion');

                const dbMessageId = targetMsg?.dbMessageId || (typeof msgId === 'string' ? msgId : null);
                if (dbMessageId) {
                    const { error: updateMsgError } = await supabase.from('messages')
                        .update({ content: streamFinalSummary || AGENT_FINAL.text })
                        .eq('id', dbMessageId);
                    if (updateMsgError) {
                        console.warn('Failed to update approved HITL message', updateMsgError);
                    } else {
                        await persistMessageArtifactBundle({
                            threadId: activeThread,
                            messageId: dbMessageId,
                            userId: user.id,
                            agentState: {
                                isStreaming: false,
                                status: 'completed',
                                phase: 2,
                                stepIndex: 99,
                                text: streamFinalSummary || AGENT_FINAL.text,
                                files: [...new Set([...streamArtifactDocFiles, ...streamGeneratedFileList])],
                                generatedFileMap: streamGeneratedFileMap,
                                runMode: 'real',
                                stageTimings: streamStageTimings,
                                reviewUpdates: streamReviewUpdates,
                                dbMessageId,
                            },
                            previewFiles: { ...runtimePreviewFiles, ...streamPreviewFiles },
                        });
                    }
                }

                appendInterfaceThreadContext(activeThread, { role: 'agent', content: streamFinalSummary || AGENT_FINAL.text });
                isGeneratingRef.current = false;
                setIsTyping(false);
                setPanelMode(null);
                inputRef.current?.focus();
                return;
            } catch (err) {
                const isAbort = err?.name === 'AbortError' || /aborted|abort/i.test(String(err?.message || ''));
                if (isAbort) {
                    setMessages(curr => curr.map(msg => msg.id === msgId ? {
                        ...msg,
                        isStreaming: false,
                        status: 'completed',
                        text: 'Interius stopped the pipeline at your request.',
                        reviewUpdates: [
                            ...(Array.isArray(msg.reviewUpdates) ? msg.reviewUpdates.slice(-4) : []),
                            { id: `${Date.now()}-resume-stopped`, kind: 'revision', text: 'Pipeline stopped by user.' }
                        ],
                    } : msg));
                    isGeneratingRef.current = false;
                    setIsTyping(false);
                    return;
                }
                console.warn('Failed to resume approved real pipeline checkpoint:', err);
                setMessages(curr => curr.map(msg => msg.id === msgId ? {
                    ...msg,
                    isStreaming: false,
                    status: 'awaiting_approval',
                    reviewUpdates: [
                        ...(Array.isArray(msg.reviewUpdates) ? msg.reviewUpdates.slice(-4) : []),
                        { id: `${Date.now()}-resume-error`, kind: 'revision', text: `Resume failed: ${err.message || err}` }
                    ],
                } : msg));
                isGeneratingRef.current = false;
                setIsTyping(false);
                return;
            } finally {
                activeStreamAbortRef.current = null;
            }
        }

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
            ...AGENT_FINAL,
            text: AGENT_FINAL.text
        };

        setMessages(curr => curr.map(msg => msg.id === msgId ? { ...msg, ...finalPayload } : msg));

        // Save final agent message to DB
        await supabase.from('messages').insert({
            thread_id: activeThread,
            user_id: user.id,
            role: 'agent',
            content: AGENT_FINAL.text
        });
        appendInterfaceThreadContext(activeThread, { role: 'agent', content: AGENT_FINAL.text });

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

    const triggerFileDownload = (filename, content) => {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    const downloadFilesIndividually = (fileMap = MOCK_FILES) => {
        Object.entries(fileMap).forEach(([path, content]) => {
            const flatName = `${MOCK_EXPORT_ROOT}__${path.replaceAll('/', '__')}`;
            triggerFileDownload(flatName, content);
        });
    };

    const writeFileToDirectory = async (rootHandle, relativePath, content) => {
        const normalizedPath = String(relativePath || '')
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .trim();
        const sanitizeSegment = (segment) =>
            String(segment || '')
                .trim()
                .replace(/[<>:"|?*\u0000-\u001F]/g, '_')
                .replace(/\.$/, '_')
                .slice(0, 180);
        const parts = normalizedPath.split('/').filter(Boolean).map(sanitizeSegment).filter(Boolean);
        if (!parts.length) return;
        let dirHandle = rootHandle;

        for (let i = 0; i < parts.length - 1; i++) {
            dirHandle = await dirHandle.getDirectoryHandle(parts[i], { create: true });
        }

        const fileHandle = await dirHandle.getFileHandle(parts[parts.length - 1], { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(typeof content === 'string' ? content : String(content ?? ''));
        await writable.close();
    };

    const exportBackendBundle = async (fileMap = MOCK_FILES) => {
        try {
            if (typeof window.showDirectoryPicker === 'function') {
                const selectedDir = await window.showDirectoryPicker({ mode: 'readwrite' });
                if (typeof selectedDir.requestPermission === 'function') {
                    const permission = await selectedDir.requestPermission({ mode: 'readwrite' });
                    if (permission !== 'granted') {
                        throw new Error('Write permission denied for selected folder');
                    }
                }
                const backendDir = await selectedDir.getDirectoryHandle(MOCK_EXPORT_ROOT, { create: true });

                for (const [path, content] of Object.entries(fileMap)) {
                    await writeFileToDirectory(backendDir, path, content);
                }
                alert('Backend files exported to a backend/ folder.');
                return;
            }
        } catch (error) {
            if (error?.name === 'AbortError') return;
            console.warn('Directory export failed, falling back to file downloads:', error);
            const msg = error?.message ? ` (${error.message})` : '';
            alert(`Directory export failed${msg}. Downloading files individually instead.`);
        }

        downloadFilesIndividually(fileMap);
        if (typeof window.showDirectoryPicker !== 'function') {
            alert('Downloaded backend files individually (directory export is not supported in this browser).');
        }
    };

    const getPreviewFileContent = (filename) => previewFilesMap[filename] ?? '// File content not available';

    const isMarkdownPreview = (filename) => {
        if (!filename) return false;
        const lower = filename.toLowerCase();
        return lower.endsWith('.md') || filename === 'Requirements Document' || filename === 'Architecture Design';
    };

    const copyPreviewContent = async () => {
        if (!previewFile) return;
        const content = getPreviewFileContent(previewFile);
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(content);
            } else {
                throw new Error('Clipboard API unavailable');
            }
            setCopyPreviewStatus('copied');
        } catch (error) {
            console.warn('Copy preview content failed', error);
            setCopyPreviewStatus('failed');
        } finally {
            if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
            copyResetTimeoutRef.current = setTimeout(() => setCopyPreviewStatus('idle'), 1400);
        }
    };

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
                                if (editingThreadId === t.id) return;
                                isGeneratingRef.current = false;
                                localStorage.setItem('interius_active_thread', t.id);
                                setIsMessagesLoading(true);
                                setActiveThread(t.id);
                            }}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 6h14M5 12h10M5 18h7" /></svg>
                            {editingThreadId === t.id ? (
                                <>
                                    <input
                                        className="cp-thread-edit-input"
                                        value={editingThreadTitle}
                                        autoFocus
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => setEditingThreadTitle(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveThreadTitle(e, t.id);
                                            if (e.key === 'Escape') cancelEditThreadTitle(e);
                                        }}
                                    />
                                    <div className="cp-thread-edit-actions" onClick={(e) => e.stopPropagation()}>
                                        <button className="cp-thread-edit-btn" title="Save thread name" onClick={(e) => saveThreadTitle(e, t.id)}>
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                        </button>
                                        <button className="cp-thread-edit-btn" title="Cancel rename" onClick={cancelEditThreadTitle}>
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <span className="cp-thread-title">{t.title}</span>
                                    <button
                                        className="cp-thread-rename"
                                        title="Rename thread"
                                        onClick={(e) => beginEditThreadTitle(e, t)}
                                    >
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                                    </button>
                                    <button
                                        className="cp-thread-delete"
                                        title="Delete thread"
                                        onClick={(e) => handleDeleteThread(e, t.id)}
                                    >
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                    </button>
                                </>
                            )}
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
                                {messages.map((msg, i) => {
                                    const prevMsg = messages[i - 1];
                                    const nextMsg = messages[i + 1];
                                    const assistantIsPipelineAck =
                                        msg.type === 'assistant' &&
                                        nextMsg?.type === 'agent';
                                    const suppressAgentSummaryText =
                                        msg.type === 'agent' &&
                                        msg.status === 'completed' &&
                                        prevMsg?.type === 'assistant';
                                    const agentPrefaceText =
                                        msg.type === 'agent' && prevMsg?.type === 'assistant'
                                            ? prevMsg.text
                                            : '';
                                    const allArtifactFiles = Array.isArray(msg.files) ? msg.files : [];
                                    const nonCodeArtifacts = allArtifactFiles.filter((f) =>
                                        ['Requirements Document.md', 'Architecture Diagram.mmd', 'Architecture Design.md'].includes(f)
                                    );
                                    const codeArtifactFiles = allArtifactFiles.filter((f) => !nonCodeArtifacts.includes(f));

                                    if (assistantIsPipelineAck) {
                                        return null;
                                    }

                                    return (
                                    <motion.div key={msg.id ?? i} className={`cp-msg ${msg.type}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
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
                                        ) : msg.type === 'assistant' ? (
                                            <div className="cp-agent-wrap">
                                                <div className="cp-agent-avatar">
                                                    <span className="cp-agent-mini-mark" aria-hidden="true">
                                                        <span className="cp-agent-mini-i">I</span><span className="cp-agent-mini-dot">.</span>
                                                    </span>
                                                </div>
                                                {msg.text && <div className="cp-bubble cp-assistant-bubble">{msg.text}</div>}
                                            </div>
                                        ) : (
                                            <div className="cp-agent-wrap">
                                                <div className="cp-agent-avatar">
                                                    <span className="cp-agent-mini-mark" aria-hidden="true">
                                                        <span className="cp-agent-mini-i">I</span><span className="cp-agent-mini-dot">.</span>
                                                    </span>
                                                </div>
                                                <div className="cp-agent-body">
                                                    {agentPrefaceText && (
                                                        <div className="cp-agent-preface">
                                                            {agentPrefaceText}
                                                        </div>
                                                    )}
                                                    {/* Thought Process Tree */}
                                                    <div className="cp-thought-process">
                                                        <details
                                                            className="cp-thought-details"
                                                            open={msg.isStreaming || msg.status === 'awaiting_approval'}
                                                        >
                                                            <summary className="cp-thought-summary">
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21" /></svg>
                                                                <span
                                                                    className={`cp-run-dot-inline ${msg.runMode === 'real' ? 'real' : 'mock'}`}
                                                                    role="img"
                                                                    aria-label={msg.runMode === 'real' ? 'Real Run' : 'Mock Run'}
                                                                    title={msg.runMode === 'real' ? 'Live backend pipeline stream' : 'Mock pipeline simulation'}
                                                                />
                                                                View thought process
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
                                                                                    <button type="button" className="cp-run-stop-btn" title="Stop pipeline" aria-label="Stop pipeline" onClick={handleStopPipeline}>
                                                                                        <span className="cp-run-spinner" />
                                                                                    </button>
                                                                                ) : (
                                                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                                                                )}
                                                                                <span>{isCurrent ? step.text : step.doneText}</span>
                                                                                {(() => {
                                                                                    const duration = getStageDuration(msg, step.id === 'req' ? 'requirements' : 'architecture');
                                                                                    return duration ? <span className="cp-stage-time">{duration}</span> : null;
                                                                                })()}
                                                                            </div>
                                                                            {isPast && step.sub && (
                                                                                <div className="cp-tree-sub">
                                                                                    {step.sub.map((s, sIdx) => (
                                                                                        <div key={sIdx} className="cp-tree-sub-item">
                                                                                            <span className="cp-tree-elbow">└─</span>
                                                                                            {autoApprove ? <span className="cp-sub-auto">Autoapproved</span> : <span className="cp-sub-auto">—</span>}
                                                                                            {!s.action ? (
                                                                                                <span className="cp-tree-sub-label">{s.label}</span>
                                                                                            ) : s.action?.startsWith?.('file:') ? (
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
                                                                                    <button type="button" className="cp-run-stop-btn" title="Stop pipeline" aria-label="Stop pipeline" onClick={handleStopPipeline}>
                                                                                        <span className="cp-run-spinner" />
                                                                                    </button>
                                                                                ) : (
                                                                                    step.icon === 'deploy' ?
                                                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                                                                        : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                                                                )}
                                                                                <span>{isCurrent ? step.text : step.doneText}</span>
                                                                                {(() => {
                                                                                    const duration = getStageDuration(msg, step.id === 'code' ? 'implementer' : 'reviewer');
                                                                                    return duration ? <span className="cp-stage-time">{duration}</span> : null;
                                                                                })()}
                                                                            </div>
                                                                            {isPast && step.sub && (
                                                                                <div className="cp-tree-sub">
                                                                                    {step.sub.map((s, sIdx) => (
                                                                                        <div key={sIdx} className="cp-tree-sub-item">
                                                                                            <span className="cp-tree-elbow">└─</span>
                                                                                            {autoApprove ? <span className="cp-sub-auto">Autoapproved</span> : <span className="cp-sub-auto">—</span>}
                                                                                            {!s.action ? (
                                                                                                <span className="cp-tree-sub-label">{s.label}</span>
                                                                                            ) : s.action?.startsWith?.('file:') ? (
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
                                                            {Array.isArray(msg.reviewUpdates) && msg.reviewUpdates.length > 0 && (
                                                                <div className="cp-review-stream">
                                                                    {msg.reviewUpdates.map((note) => (
                                                                        <div key={note.id || note.text} className={`cp-review-stream-item ${note.kind || 'info'}`}>
                                                                            <span className="cp-review-stream-dot" />
                                                                            <span>{note.text}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </details>
                                                    </div>

                                                    {/* Human in the loop halt block */}
                                                    {msg.status === 'awaiting_approval' && (
                                                        <div className="cp-review-block">
                                                            <div className="cp-review-content">
                                                                <p>I have generated the Initial Requirements and Architecture. Please review them.</p>
                                                                {nonCodeArtifacts.length > 0 && (
                                                                    <div className="cp-agent-artifact-section">
                                                                        <div className="cp-agent-artifact-label">Artifacts to Review</div>
                                                                        <div className="cp-agent-files-group">
                                                                            {nonCodeArtifacts.map(f => (
                                                                                <button key={f} className="cp-file-pill" onClick={() => openFilePreviewer(f)}>
                                                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                                                                    {f}
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="cp-review-actions">
                                                                <button className="cp-action-btn cp-action-approve" onClick={() => approvePhase1(msg.id)}>
                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                                                                    Approve to Continue
                                                                </button>
                                                                <button className="cp-action-btn cp-action-suggest" onClick={() => { setPreviewFile('Requirements Document.md'); setPanelMode('file'); setSuggestOpen(true); }}>
                                                                    Suggest Edits
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Final output block */}
                                                    {msg.status === 'completed' && msg.text && (
                                                        <div className="cp-final-output">
                                                            {!suppressAgentSummaryText && <p className="cp-agent-text">{msg.text}</p>}

                                                            {nonCodeArtifacts.length > 0 && (
                                                                <div className="cp-agent-artifact-section">
                                                                    <div className="cp-agent-artifact-label">Artifacts</div>
                                                                    <div className="cp-agent-files-group">
                                                                        {nonCodeArtifacts.map(f => (
                                                                            <button key={f} className="cp-file-pill" onClick={() => openFilePreviewer(f)}>
                                                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                                                                {f}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {codeArtifactFiles.length > 0 && (
                                                                <div className="cp-agent-artifact-section">
                                                                    <div className="cp-agent-artifact-label">Code Files</div>
                                                                    <div className="cp-agent-files-group">
                                                                        {codeArtifactFiles.map(f => (
                                                                            <button key={f} className="cp-file-pill code-chip" onClick={() => openFilePreviewer(f)}>
                                                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                                                                {f}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {msg.status === 'completed' && msg.phase >= 2 && (
                                                                <div className="cp-export-block">
                                                                    <div className="cp-deploy-content">
                                                                        Download the generated backend files so you can drop the <code>backend/</code> folder into your project.
                                                                    </div>
                                                                    <button
                                                                        className="cp-action-btn cp-action-download"
                                                                        onClick={() => exportBackendBundle(
                                                                            (msg.runMode === 'real' && Object.keys(msg.generatedFileMap || {}).length)
                                                                                ? msg.generatedFileMap
                                                                                : MOCK_FILES
                                                                        )}
                                                                    >
                                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                                            <polyline points="7 10 12 15 17 10" />
                                                                            <line x1="12" y1="15" x2="12" y2="3" />
                                                                        </svg>
                                                                        Download Backend Files
                                                                    </button>
                                                                </div>
                                                            )}

                                                            {/* Always show deployment blocks for completed pipeline phases, regardless of explicit payload flags */}
                                                            {msg.status === 'completed' && msg.phase >= 2 && msg.runMode !== 'real' && (
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
                                );})}


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
                                onClick={pipelineInProgress ? handleStopPipeline : handleSend}
                                disabled={pipelineInProgress ? false : (!input.trim() && attachedFiles.length === 0)}
                                aria-label={pipelineInProgress ? 'Stop pipeline' : 'Send'}
                                title={pipelineInProgress ? 'Stop pipeline' : 'Send'}
                            >
                                {pipelineInProgress ? (
                                    <span className="cp-send-stop" aria-hidden="true">
                                        <span className="cp-send-spinner" />
                                        <span className="cp-send-stop-square" />
                                    </span>
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
                                        <button
                                            className="cp-suggest-btn"
                                            onClick={copyPreviewContent}
                                            title="Copy file contents"
                                            style={{ marginLeft: 'auto', padding: '6px 10px' }}
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                            </svg>
                                            {copyPreviewStatus === 'copied' ? 'Copied' : copyPreviewStatus === 'failed' ? 'Copy failed' : 'Copy'}
                                        </button>
                                    </div>
                                    {previewFile?.toLowerCase?.().endsWith('.mmd') ? (
                                        <div className="cp-ide-scroll">
                                            <MermaidPreview code={getPreviewFileContent(previewFile)} theme={theme} />
                                        </div>
                                    ) : isMarkdownPreview(previewFile) ? (
                                        <div className="cp-ide-scroll">
                                            <div className="cp-preview-markdown">
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                components={{
                                                        code({ inline, children, ...props }) {
                                                            if (inline) {
                                                                return (
                                                                    <code
                                                                        style={{
                                                                            fontFamily: 'var(--font-mono)',
                                                                            background: 'color-mix(in srgb, var(--ide-toolbar-bg) 60%, transparent)',
                                                                            border: '1px solid var(--ide-border)',
                                                                            borderRadius: 6,
                                                                            padding: '0.08rem 0.35rem',
                                                                            fontSize: '0.92em',
                                                                            color: 'var(--ide-text)',
                                                                        }}
                                                                        {...props}
                                                                    >
                                                                        {children}
                                                                    </code>
                                                                );
                                                            }
                                                            return (
                                                                <pre
                                                                    style={{
                                                                        background: 'var(--ide-toolbar-bg)',
                                                                        border: '1px solid var(--ide-border)',
                                                                        borderRadius: 10,
                                                                        padding: 12,
                                                                        overflowX: 'auto',
                                                                    }}
                                                                >
                                                                    <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--ide-text)' }} {...props}>{children}</code>
                                                                </pre>
                                                            );
                                                        },
                                                        a({ children, ...props }) {
                                                            return <a className="cp-tree-link" target="_blank" rel="noreferrer" {...props}>{children}</a>;
                                                        },
                                                        li({ children, ...props }) {
                                                            const parsedField = parseRequirementFieldListItem(children);
                                                            if (parsedField) {
                                                                return (
                                                                    <li className="cp-md-field-item" {...props}>
                                                                        <div className="cp-md-field-row">
                                                                            <span className="cp-md-field-name">{parsedField.name}</span>
                                                                            <span className="cp-md-field-type">{parsedField.type}</span>
                                                                            <span className={`cp-md-field-req ${parsedField.required}`}>{parsedField.required}</span>
                                                                        </div>
                                                                    </li>
                                                                );
                                                            }
                                                            return <li {...props}>{children}</li>;
                                                        }
                                                    }}
                                                >
                                                    {getPreviewFileContent(previewFile)}
                                                </ReactMarkdown>
                                            </div>
                                        </div>
                                    ) : (
                                    <div className="cp-ide-scroll">
                                        <table className="cp-ide-table">
                                            <tbody>
                                                {getPreviewFileContent(previewFile).split('\n').map((line, i) => (
                                                    <tr key={i} className="cp-ide-row">
                                                        <td className="cp-ide-ln">{i + 1}</td>
                                                        <td
                                                            className="cp-ide-line"
                                                            dangerouslySetInnerHTML={{
                                                                __html: (
                                                                    shouldSyntaxHighlightFile(previewFile)
                                                                        ? (syntaxHighlight(line) || '&nbsp;')
                                                                        : (escapeHtml(line) || '&nbsp;')
                                                                )
                                                            }}
                                                        />
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    )}
                                    {canSuggestEditsInPreview && (
                                        <div className="cp-suggest-footer">
                                            {suggestOpen ? (
                                                <div style={{ position: 'relative' }}>
                                                    {suggestAtMenu && (
                                                        <div className="cp-suggest-at-menu">
                                                            {Object.keys(previewFilesMap).map(f => (
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
                                                    <div className="cp-suggest-actions-inline">
                                                        <button
                                                            type="button"
                                                            className="cp-suggest-cancel"
                                                            onClick={() => {
                                                                setSuggestOpen(false);
                                                                setSuggestAtMenu(false);
                                                                setEditSuggestion('');
                                                            }}
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="cp-suggest-btn active"
                                                            onClick={submitSuggestEdits}
                                                            disabled={!editSuggestion.trim()}
                                                        >
                                                            Apply edits
                                                        </button>
                                                    </div>
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
                                    )}
                                </div>
                            )}
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>
        </div>
    );
}
