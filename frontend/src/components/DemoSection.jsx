import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './DemoSection.css';

const SEED_MESSAGES = [
    { id: 's1', type: 'user', text: 'Build a REST API for task management with user auth and CRUD operations' },
    {
        id: 's2', type: 'agent',
        meta: ['Thought 5s', 'Planned architecture'],
        files: ['app/main.py', 'app/models.py', 'app/routes.py', 'Dockerfile'],
        text: 'Built the API with 12 tests — all passing. Container ready.',
    },
    { id: 's3', type: 'user', text: 'Ship it' },
    {
        id: 's4', type: 'agent',
        meta: ['Pushed to registry'],
        text: 'Deployed interius/task-api:latest — live and ready.',
    },
];

export default function DemoSection({ onOpenLogin }) {
    const [messages, setMessages] = useState(SEED_MESSAGES);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const bottomRef = useRef(null);
    const chatMessagesRef = useRef(null);
    const inputRef = useRef(null);

    useEffect(() => {
        const el = chatMessagesRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, isTyping]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || isTyping) return;
        setInput('');
        setMessages((m) => [...m, { id: Date.now(), type: 'user', text }]);
        setIsTyping(true);
        await new Promise((r) => setTimeout(r, 1500));
        setIsTyping(false);
        setMessages((m) => [...m, {
            id: Date.now() + 1,
            type: 'cta',
            text: 'Your API is ready to deploy! Open Interius to view your live endpoints, run tests, and manage your deployment.',
        }]);
    };

    const handleKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); handleSend(); }
    };

    return (
        <section className="demo-section" id="demo">
            <motion.div
                className="demo-container"
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
                {/* Window chrome */}
                <div className="cw-titlebar">
                    <div className="cw-dots">
                        <span className="dot r" /><span className="dot y" /><span className="dot g" />
                    </div>
                </div>

                {/* Three-panel layout */}
                <div className="cw-body">
                    {/* Sidebar */}
                    <div className="cw-sidebar">
                        <button className="cw-new-thread">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                            New thread
                        </button>
                        <nav className="cw-sidebar-nav">
                            <a href="#">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                                Automations
                            </a>
                            <a href="#">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                                Skills
                            </a>
                        </nav>
                        <div className="cw-threads">
                            <span className="threads-label">Threads</span>
                            <a className="thread-item active">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
                                Build Task API
                            </a>
                            <a className="thread-item">Add Auth Module <span className="t-time">4h</span></a>
                            <a className="thread-item">Dockerize Service <span className="t-time">8h</span></a>
                            <a className="thread-item">Deploy to Cloud <span className="t-time">1d</span></a>
                            <a className="thread-item">Setup CI/CD <span className="t-time">2d</span></a>
                        </div>
                    </div>

                    {/* Chat */}
                    <div className="cw-chat">
                        <div className="cw-chat-topbar">
                            <span className="task-name">Build Task API</span>
                            <span className="task-repo">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 22v-4a4.8 4.8 0 00-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 004 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>
                                interius/demo
                            </span>
                            <div className="topbar-actions">
                                <button className="topbar-btn">Open</button>
                                <button className="topbar-btn primary">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="22 6 12 13 2 6" /><path d="M2 6h20v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
                                    Test Endpoints
                                </button>
                            </div>
                        </div>

                        <div className="cw-chat-messages" ref={chatMessagesRef}>
                            <AnimatePresence initial={false}>
                                {messages.map((msg) => (
                                    <motion.div
                                        key={msg.id}
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.25 }}
                                    >
                                        {msg.type === 'user' && (
                                            <div className="msg user-msg">{msg.text}</div>
                                        )}
                                        {msg.type === 'agent' && (
                                            <div className="msg agent-msg">
                                                {msg.meta?.map((m) => <div key={m} className="agent-meta">{m}</div>)}
                                                {msg.files && (
                                                    <div className="agent-files">
                                                        {msg.files.map((f) => (
                                                            <div key={f} className="agent-file">
                                                                <span>Created</span> {f}
                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                <p>{msg.text}</p>
                                            </div>
                                        )}
                                        {msg.type === 'cta' && (
                                            <div className="msg agent-msg demo-cta-msg">
                                                <p>{msg.text}</p>
                                                <button className="demo-open-btn" onClick={onOpenLogin}>
                                                    Open Interius →
                                                </button>
                                            </div>
                                        )}
                                    </motion.div>
                                ))}
                                {isTyping && (
                                    <motion.div
                                        key="typing"
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="msg agent-msg"
                                    >
                                        <div className="demo-typing">
                                            <span /><span /><span />
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                            <div ref={bottomRef} />
                        </div>

                        <div className="cw-chat-input">
                            <div className="chat-input-inner">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    placeholder="Ask Interius anything…"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKey}
                                />
                                <button
                                    className={`send-btn${input.trim() ? ' active' : ''}`}
                                    onClick={handleSend}
                                    disabled={!input.trim() || isTyping}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94l18.04-8.01a.75.75 0 000-1.36L3.478 2.405z" /></svg>
                                </button>
                            </div>
                            <div className="chat-input-meta">
                                <span className="model-label">Interius Pro</span>
                            </div>
                        </div>
                    </div>

                    {/* Diff panel */}
                    <div className="cw-diff">
                        <div className="diff-header">
                            <span>4 files changed</span>
                            <span className="diff-add">+186</span>
                            <span className="diff-del">-0</span>
                        </div>
                        <div className="diff-files">
                            <div className="diff-file-item"><span>app/main.py</span><span className="diff-add">+42</span><span className="diff-del">-0</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg></div>
                            <div className="diff-file-item"><span>app/models.py</span><span className="diff-add">+38</span><span className="diff-del">-0</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg></div>
                            <div className="diff-file-item active"><span>app/routes.py</span><span className="diff-add">+78</span><span className="diff-del">-0</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg></div>
                            <div className="diff-file-item"><span>Dockerfile</span><span className="diff-add">+28</span><span className="diff-del">-0</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg></div>
                        </div>
                        <div className="diff-code">
                            <pre><code>{`  app/routes.py\n\n`}<span className="line-add">+ from fastapi import APIRouter, Depends</span>{`\n`}<span className="line-add">+ from sqlalchemy.orm import Session</span>{`\n`}<span className="line-add">+ from . import models, schemas, auth</span>{`\n`}<span className="line-add">+</span>{`\n`}<span className="line-add">+ router = APIRouter()</span>{`\n`}<span className="line-add">+</span>{`\n`}<span className="line-add">+ @router.get("/tasks")</span>{`\n`}<span className="line-add">+ async def list_tasks(</span>{`\n`}<span className="line-add">+     db: Session = Depends(get_db),</span>{`\n`}<span className="line-add">+     user = Depends(auth.current_user)</span>{`\n`}<span className="line-add">+ ):</span>{`\n`}<span className="line-add">+     return db.query(models.Task)</span>{`\n`}<span className="line-add">+         .filter_by(owner=user.id)</span>{`\n`}<span className="line-add">+         .all()</span></code></pre>
                        </div>
                    </div>
                </div>
            </motion.div>
        </section>
    );
}
