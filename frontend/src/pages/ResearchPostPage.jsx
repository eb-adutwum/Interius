import { useParams, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { RESEARCH_POSTS } from './ResearchPage';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export default function ResearchPostPage({ onOpenLogin, theme, onThemeToggle }) {
    const { id } = useParams();
    const post = RESEARCH_POSTS.find(p => p.id === id);

    if (!post) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg-primary)' }}>
                <Navbar onLoginClick={onOpenLogin} theme={theme} onThemeToggle={onThemeToggle} />
                <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <h1 style={{ fontSize: '2rem' }}>Paper not found</h1>
                </main>
                <Footer />
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            <Navbar onLoginClick={onOpenLogin} theme={theme} onThemeToggle={onThemeToggle} />

            <main style={{ flex: 1, padding: '120px 20px', maxWidth: '1100px', margin: '0 auto', width: '100%' }}>
                <article>
                    <header style={{ textAlign: 'center', marginBottom: '60px', maxWidth: '950px', margin: '0 auto' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-primary)', marginBottom: '24px', letterSpacing: '0.01em', display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '12px' }}>
                            <span>{post.date}</span>
                            <span style={{ opacity: 0.3 }}>•</span>
                            <span style={{ opacity: 0.6, fontWeight: '400', color: 'var(--text-secondary)' }}>Prosit Technical Report</span>
                            <span style={{ opacity: 0.3 }}>•</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: 'var(--text-primary)' }}>
                                    {post.author.charAt(0)}
                                </div>
                                {post.author}
                            </span>
                        </div>

                        <h1 style={{ fontSize: 'clamp(2.5rem, 5vw, 3.5rem)', fontWeight: '600', letterSpacing: '-0.03em', lineHeight: '1.1', marginBottom: '24px', color: 'var(--text-primary)' }}>
                            {post.title}
                        </h1>

                        <p style={{ fontSize: '1.25rem', lineHeight: '1.6', color: 'var(--text-primary)', margin: '0 auto 40px auto' }}>
                            {post.excerpt}
                        </p>

                        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
                            <a href={post.codeLink} target="_blank" rel="noopener noreferrer" style={{
                                padding: '8px 16px',
                                background: 'transparent',
                                color: 'var(--text-primary)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '20px',
                                fontSize: '0.95rem',
                                fontWeight: '500',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                textDecoration: 'none',
                                transition: 'background 0.2s',
                            }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                View code ↗
                            </a>

                            <button style={{
                                padding: '8px 16px',
                                background: 'var(--text-primary)',
                                color: 'var(--bg-primary)',
                                border: 'none',
                                borderRadius: '20px',
                                fontSize: '0.95rem',
                                fontWeight: '600',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'background 0.2s'
                            }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--text-secondary)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'var(--text-primary)'}
                            >
                                Visit prosits.interius.com ↗
                            </button>
                        </div>
                    </header>

                    <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '60px 0', paddingTop: '40px' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: '500', marginBottom: '40px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" /></svg>
                            Share
                        </div>

                        <div style={{
                            fontSize: '1.15rem',
                            lineHeight: '1.8',
                            color: 'var(--text-primary)',
                            fontFamily: 'Inter, system-ui, sans-serif'
                        }}>
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                                components={{
                                    h2: ({ node, ...props }) => <h2 style={{ fontSize: '1.85rem', fontWeight: '600', letterSpacing: '-0.01em', marginTop: '3.5rem', marginBottom: '1.25rem', color: 'var(--text-primary)', lineHeight: '1.3' }} {...props} />,
                                    h3: ({ node, ...props }) => <h3 style={{ fontSize: '1.4rem', fontWeight: '600', letterSpacing: '-0.005em', marginTop: '2.5rem', marginBottom: '1rem', color: 'var(--text-primary)' }} {...props} />,
                                    p: ({ node, ...props }) => <p style={{ marginBottom: '1.75rem', opacity: 0.9 }} {...props} />,
                                    ul: ({ node, ...props }) => <ul style={{ marginBottom: '1.75rem', paddingLeft: '2rem', opacity: 0.9 }} {...props} />,
                                    li: ({ node, ...props }) => <li style={{ marginBottom: '0.75rem' }} {...props} />,
                                    blockquote: ({ node, ...props }) => <blockquote style={{ borderLeft: '4px solid var(--border-subtle)', margin: '2rem 0', padding: '0.5rem 0 0.5rem 1.5rem', fontStyle: 'italic', opacity: 0.8 }} {...props} />,
                                }}
                            >
                                {post.content}
                            </ReactMarkdown>
                        </div>
                    </div>
                </article>
            </main>

            <Footer />
        </div>
    );
}
