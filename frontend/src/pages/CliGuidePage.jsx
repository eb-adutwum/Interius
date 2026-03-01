import { useState } from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const currentBackendUrl =
    import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.VITE_BACKEND_API_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    'http://localhost:8000';
const installCommand = 'npm install -g @interius/cli';
const loginCommand = `interius login ${currentBackendUrl}`;
const buildCommand = [
    'cd path/to/your-project',
    'interius "Build a FastAPI expense tracker API with auth and CRUD endpoints"',
].join('\n');
const manageCommand = [
    'interius status',
    'interius logs',
    'interius stop',
].join('\n');
const quickstartCommand = [
    'npm install -g @interius/cli',
    `interius login ${currentBackendUrl}`,
    'cd path/to/your-project',
    'interius "Build a FastAPI expense tracker API with auth and CRUD endpoints"',
].join('\n');

const docsSections = [
    {
        eyebrow: 'Install',
        title: '1. Install the CLI globally',
        body: 'The hosted Interius backend is already running for you. Installation is the only system-wide setup step.',
        command: installCommand,
        note: 'After this, the `interius` command is available in any project folder.',
    },
    {
        eyebrow: 'Connect',
        title: '2. Point the CLI at your hosted Interius server',
        body: 'Run login once to save the backend URL. Future builds reuse the stored connection automatically.',
        command: loginCommand,
        note: 'The CLI stores connection details in `~/.interius/config.json`.',
    },
    {
        eyebrow: 'Build',
        title: '3. Generate directly inside your local project folder',
        body: 'Interius reads the current workspace as context, streams the same backend pipeline, writes repaired files locally, installs dependencies, and starts the app on your machine.',
        command: buildCommand,
        note: 'When the run succeeds, the CLI prints the local Swagger UI URL to test immediately.',
    },
    {
        eyebrow: 'Manage',
        title: '4. Inspect or stop the local app',
        body: 'Use the built-in runtime commands to confirm the app is alive, read startup logs, or stop the local server.',
        command: manageCommand,
        note: 'No Docker is involved. The CLI manages a local `.venv` and local process state under `.interius/`.',
    },
];

const flowItems = [
    'The backend still runs the same flow: requirements -> architecture -> implementer -> reviewer -> repair.',
    'Repair can modify generated files before release if startup logs or endpoint checks expose failures.',
    'Generated files are written into your current project folder, with backups stored under `.interius/backups`.',
    'The CLI starts the generated FastAPI app locally and prints the Swagger UI link when it is ready.',
];

function CopyButton({ text, label = 'Copy' }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } catch {
            setCopied(false);
        }
    };

    return (
        <button
            type="button"
            onClick={handleCopy}
            style={{
                border: '1px solid rgba(125, 211, 252, 0.28)',
                background: copied ? 'rgba(16, 185, 129, 0.18)' : 'rgba(15, 23, 42, 0.72)',
                color: copied ? '#bbf7d0' : '#dbeafe',
                borderRadius: '999px',
                padding: '9px 14px',
                fontSize: '0.84rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 180ms ease',
            }}
        >
            {copied ? 'Copied' : label}
        </button>
    );
}

function DocCommandBlock({ command, label }) {
    return (
        <div
            style={{
                marginTop: '18px',
                borderRadius: '18px',
                overflow: 'hidden',
                border: '1px solid rgba(148, 163, 184, 0.16)',
                background: 'rgba(2, 6, 23, 0.98)',
                boxShadow: '0 24px 70px -36px rgba(15, 23, 42, 0.48)',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    padding: '14px 16px',
                    borderBottom: '1px solid rgba(148, 163, 184, 0.14)',
                    background: 'rgba(15, 23, 42, 0.86)',
                }}
            >
                <span style={{ color: 'rgba(226, 232, 240, 0.72)', fontSize: '0.82rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    {label}
                </span>
                <CopyButton text={command} />
            </div>
            <pre
                style={{
                    margin: 0,
                    padding: '18px 20px',
                    overflowX: 'auto',
                    color: '#93c5fd',
                    fontSize: '0.95rem',
                    lineHeight: 1.75,
                    fontFamily: 'var(--font-mono)',
                }}
            >
                {command}
            </pre>
        </div>
    );
}

function DocsSection({ eyebrow, title, body, command, note }) {
    return (
        <section
            style={{
                padding: '28px',
                borderRadius: '24px',
                background: 'rgba(255, 255, 255, 0.92)',
                border: '1px solid rgba(148, 163, 184, 0.16)',
                boxShadow: '0 28px 80px -48px rgba(15, 23, 42, 0.34)',
            }}
        >
            <div style={{ color: '#0284c7', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {eyebrow}
            </div>
            <h2 style={{ margin: '10px 0 0', fontSize: '1.42rem', letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
                {title}
            </h2>
            <p style={{ margin: '14px 0 0', color: 'var(--text-secondary)', lineHeight: 1.72, fontSize: '1rem' }}>
                {body}
            </p>
            <DocCommandBlock command={command} label={eyebrow} />
            <div style={{ marginTop: '14px', color: 'rgba(71, 85, 105, 0.9)', lineHeight: 1.65 }}>
                {note}
            </div>
        </section>
    );
}

function TerminalHero() {
    return (
        <div
            style={{
                borderRadius: '30px',
                overflow: 'hidden',
                border: '1px solid rgba(148, 163, 184, 0.16)',
                background: 'linear-gradient(180deg, rgba(17, 24, 39, 0.98) 0%, rgba(2, 6, 23, 1) 100%)',
                boxShadow: '0 42px 120px -52px rgba(15, 23, 42, 0.72)',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '18px 22px',
                    borderBottom: '1px solid rgba(148, 163, 184, 0.14)',
                    background: 'rgba(15, 23, 42, 0.84)',
                }}
            >
                <div style={{ width: 12, height: 12, borderRadius: '999px', background: '#ef4444' }} />
                <div style={{ width: 12, height: 12, borderRadius: '999px', background: '#f59e0b' }} />
                <div style={{ width: 12, height: 12, borderRadius: '999px', background: '#10b981' }} />
                <span
                    style={{
                        marginLeft: 'auto',
                        color: 'rgba(226, 232, 240, 0.58)',
                        fontSize: '0.8rem',
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        fontFamily: 'var(--font-mono)',
                    }}
                >
                    interius terminal
                </span>
            </div>
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1.15fr) minmax(320px, 0.85fr)',
                    gap: '0px',
                }}
            >
                <div style={{ padding: '28px 24px 26px', borderRight: '1px solid rgba(148, 163, 184, 0.12)' }}>
                    <div style={{ color: 'rgba(125, 211, 252, 0.9)', fontFamily: 'var(--font-mono)', fontSize: '0.96rem', lineHeight: 1.85 }}>
                        <div><span style={{ color: '#4ade80' }}>$</span> npm install -g @interius/cli</div>
                        <div><span style={{ color: '#4ade80' }}>$</span> interius login {currentBackendUrl}</div>
                        <div><span style={{ color: '#4ade80' }}>$</span> cd expense-tracker</div>
                        <div><span style={{ color: '#4ade80' }}>$</span> interius "Build a FastAPI expense tracker API with auth and CRUD endpoints"</div>
                        <div style={{ marginTop: '18px', color: 'rgba(226, 232, 240, 0.72)' }}>connecting to hosted backend...</div>
                        <div style={{ color: 'rgba(226, 232, 240, 0.72)' }}>requirements complete</div>
                        <div style={{ color: 'rgba(226, 232, 240, 0.72)' }}>architecture approved</div>
                        <div style={{ color: 'rgba(226, 232, 240, 0.72)' }}>repair passed after runtime checks</div>
                        <div style={{ color: '#67e8f9' }}>swagger: http://127.0.0.1:8012/docs</div>
                    </div>
                </div>
                <div
                    style={{
                        padding: '28px 24px 26px',
                        background: 'radial-gradient(circle at top left, rgba(34, 211, 238, 0.18) 0%, transparent 42%), rgba(15, 23, 42, 0.68)',
                    }}
                >
                    <div style={{ color: '#f8fafc', fontSize: '1.7rem', lineHeight: 1.02, letterSpacing: '-0.04em' }}>
                        Hosted agent.
                        <br />
                        Local execution.
                    </div>
                    <p style={{ margin: '16px 0 0', color: 'rgba(226, 232, 240, 0.76)', lineHeight: 1.72, fontSize: '1rem' }}>
                        Install the CLI, point it at your Interius server once, and build from any local folder. The
                        backend handles reasoning. The CLI handles your filesystem, dependency install, local startup,
                        and the final Swagger link.
                    </p>
                    <div style={{ marginTop: '22px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        <CopyButton text={installCommand} label="Copy install" />
                        <CopyButton text={quickstartCommand} label="Copy quickstart" />
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function CliGuidePage({ onOpenLogin, theme, onThemeToggle }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'linear-gradient(180deg, #f8fbff 0%, #eef6ff 42%, #f8fafc 100%)' }}>
            <Navbar onLoginClick={onOpenLogin} theme={theme} onThemeToggle={onThemeToggle} />
            <main style={{ flex: 1, width: '100%' }}>
                <section
                    style={{
                        padding: '88px 20px 36px',
                        background: 'radial-gradient(circle at top, rgba(34, 211, 238, 0.22) 0%, transparent 44%)',
                    }}
                >
                    <div style={{ maxWidth: '1160px', margin: '0 auto', textAlign: 'center' }}>
                        <div
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '8px 12px',
                                borderRadius: '999px',
                                background: 'rgba(15, 23, 42, 0.06)',
                                color: 'var(--text-secondary)',
                                fontSize: '0.88rem',
                                marginBottom: '18px',
                            }}
                        >
                            <span style={{ width: 8, height: 8, borderRadius: '999px', background: '#10b981' }} />
                            CLI Guide
                        </div>
                        <h1
                            style={{
                                margin: 0,
                                fontSize: 'clamp(2.4rem, 4.8vw, 4.2rem)',
                                lineHeight: 0.93,
                                letterSpacing: '-0.055em',
                                color: 'var(--text-primary)',
                                maxWidth: '760px',
                                marginInline: 'auto',
                            }}
                        >
                            Build from the shell.
                            <br />
                            Ship from your own folder.
                        </h1>
                        <p
                            style={{
                                margin: '22px 0 0',
                                maxWidth: '720px',
                                color: 'var(--text-secondary)',
                                fontSize: '1.1rem',
                                lineHeight: 1.74,
                                marginInline: 'auto',
                            }}
                        >
                            Interius keeps the agent in the backend and gives you a local terminal interface for the
                            rest. Install once, run inside any project directory, and test the generated API through the
                            local Swagger UI that the CLI starts for you.
                        </p>
                        <div style={{ marginTop: '34px', textAlign: 'left' }}>
                            <TerminalHero />
                        </div>
                    </div>
                </section>

                <section style={{ padding: '6px 20px 26px' }}>
                    <div
                        style={{
                            maxWidth: '1160px',
                            margin: '0 auto',
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                            gap: '14px',
                        }}
                    >
                        {flowItems.map((fact) => (
                            <div
                                key={fact}
                                style={{
                                    padding: '16px 18px',
                                    background: 'rgba(255, 255, 255, 0.84)',
                                    border: '1px solid rgba(148, 163, 184, 0.18)',
                                    borderRadius: '16px',
                                    color: 'var(--text-secondary)',
                                    lineHeight: 1.6,
                                    boxShadow: '0 14px 40px -28px rgba(15, 23, 42, 0.3)',
                                }}
                            >
                                {fact}
                            </div>
                        ))}
                    </div>
                </section>

                <section style={{ padding: '24px 20px 84px' }}>
                    <div style={{ maxWidth: '1160px', margin: '0 auto' }}>
                        <div style={{ marginBottom: '24px' }}>
                            <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '2rem', letterSpacing: '-0.04em' }}>
                                Documentation
                            </h2>
                            <p style={{ margin: '10px 0 0', color: 'var(--text-secondary)', lineHeight: 1.72, maxWidth: '760px' }}>
                                The backend is already hosted. These are the only commands a user needs to install the
                                CLI, connect once, build locally, and manage the generated app.
                            </p>
                        </div>

                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr',
                                gap: '18px',
                            }}
                        >
                            {docsSections.map((section) => (
                                <DocsSection key={section.title} {...section} />
                            ))}
                        </div>
                    </div>
                </section>
            </main>
            <Footer />
        </div>
    );
}
