import { useState } from 'react';
import { motion } from 'framer-motion';
import './Features.css';

const cards = [
    {
        title: 'Start in the Interius app',
        cta: "Try the app, it's free",
        preview: 'chat',
    },
    {
        title: 'Coming soon, Interius IDE',
        cta: 'Join the IDE waitlist',
        preview: 'editor',
    },
    {
        title: 'Keep going in the terminal',
        cta: '$ npm i -g @interius/cli',
        ctaCopy: true,
        preview: 'terminal',
    },
];

const containerV = { hidden: {}, visible: { transition: { staggerChildren: 0.12 } } };
const cardV = { hidden: { opacity: 0, y: 30 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5 } } };

export default function Features({ onTryApp }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = (text) => {
        const cmd = text.startsWith('$ ') ? text.slice(2) : text;
        navigator.clipboard.writeText(cmd);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <section className="features-section" id="features">
            <div className="container">
                <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.5 }}
                >
                    The same agent everywhere you build
                </motion.h2>
                <motion.p
                    className="features-sub"
                    initial={{ opacity: 0, y: 15 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ delay: 0.1, duration: 0.5 }}
                >
                    Use Interius across multiple surfaces, all connected by your account.
                </motion.p>

                <motion.div
                    className="features-grid"
                    variants={containerV}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-60px' }}
                >
                    {cards.map((c, i) => (
                        <motion.div className="feature-card" key={i} variants={cardV}>
                            <div className={`card-preview ${c.preview}`}>
                                {c.preview === 'chat' && <ChatPreview />}
                                {c.preview === 'editor' && <EditorPreview />}
                                {c.preview === 'terminal' && <TerminalPreview />}
                            </div>
                            <h3>{c.title}</h3>
                            <button
                                className={`card-cta ${copied && c.ctaCopy ? 'copied' : ''}`}
                                onClick={() => {
                                    if (c.cta === "Try the app, it's free" && onTryApp) {
                                        onTryApp();
                                    } else if (c.ctaCopy) {
                                        handleCopy(c.cta);
                                    }
                                }}
                            >
                                {c.ctaCopy && copied ? 'Copied!' : c.cta}
                                {c.ctaChevron && !copied && (
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                )}
                                {c.ctaCopy && !copied && (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                                )}
                                {c.ctaCopy && copied && (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                                )}
                            </button>
                        </motion.div>
                    ))}
                </motion.div>
            </div>
        </section>
    );
}

function ChatPreview() {
    return (
        <div className="mini-chat">
            <div className="mini-bubble">Build a weather API</div>
            <div className="mini-response">
                <div className="mini-line" style={{ width: '85%' }} />
                <div className="mini-line" style={{ width: '60%' }} />
            </div>
            <div className="mini-input-bar">
                <span>Ask Interius anything</span>
                <span className="mini-send" />
            </div>
        </div>
    );
}

function EditorPreview() {
    return (
        <div className="mini-editor">
            <div className="mini-tab-bar">
                <span className="mini-tab active">routes.py</span>
                <span className="mini-tab">models.py</span>
            </div>
            <div className="mini-code">
                <div className="mini-code-line add" style={{ width: '75%' }} />
                <div className="mini-code-line add" style={{ width: '50%' }} />
                <div className="mini-code-line" style={{ width: '65%' }} />
                <div className="mini-code-line add" style={{ width: '80%' }} />
                <div className="mini-code-line" style={{ width: '40%' }} />
            </div>
            <div className="mini-diff-badge">+83 -0</div>
        </div>
    );
}

function TerminalPreview() {
    return (
        <div className="mini-terminal">
            <div className="mini-t-line"><span className="prompt">$</span> interius deploy --dockerize</div>
            <div className="mini-t-line dim">Building Docker image...</div>
            <div className="mini-t-line dim">Running tests... 12/12 passed</div>
            <div className="mini-t-line accent">Deployed: interius/api:latest</div>
            <div className="mini-t-line"><span className="prompt">$</span> <span className="cursor" /></div>
        </div>
    );
}
