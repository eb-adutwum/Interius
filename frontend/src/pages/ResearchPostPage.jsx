import { useParams, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { RESEARCH_POSTS } from './ResearchPage';

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

            <main style={{ flex: 1, padding: '120px 20px', maxWidth: '900px', margin: '0 auto', width: '100%' }}>
                <article>
                    <header style={{ textAlign: 'center', marginBottom: '40px', maxWidth: '750px', margin: '0 auto' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-primary)', marginBottom: '24px', letterSpacing: '0.01em' }}>
                            {post.date} &nbsp;&nbsp; <span style={{ opacity: 0.4, fontWeight: '400', color: 'var(--text-secondary)' }}>Publication</span> &nbsp;&nbsp; <span style={{ opacity: 0.4, fontWeight: '400', color: 'var(--text-secondary)' }}>Research</span>
                        </div>

                        <h1 style={{ fontSize: 'clamp(2.5rem, 5vw, 3.5rem)', fontWeight: '600', letterSpacing: '-0.03em', lineHeight: '1.1', marginBottom: '24px', color: 'var(--text-primary)' }}>
                            {post.title}
                        </h1>

                        <p style={{ fontSize: '1.25rem', lineHeight: '1.6', color: 'var(--text-primary)', margin: '0 auto 40px auto' }}>
                            {post.excerpt}
                        </p>

                        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
                            <button style={{
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
                                transition: 'background 0.2s',
                            }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                Read the paper ↗
                            </button>

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
                            fontSize: '1.1rem',
                            lineHeight: '1.65',
                            color: 'var(--text-primary)',
                            whiteSpace: 'pre-wrap', // To respect newlines but allow wrapping
                            fontFamily: 'Inter, system-ui, sans-serif'
                        }}>
                            {post.content}
                        </div>
                    </div>
                </article>
            </main>

            <Footer />
        </div>
    );
}
