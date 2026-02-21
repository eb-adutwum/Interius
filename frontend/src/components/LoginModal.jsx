import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import InteriusLogo from './InteriusLogo';
import './LoginModal.css';

export default function LoginModal({ isOpen, onClose }) {
    const [mode, setMode] = useState('login'); // 'login' | 'signup'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!email || !password) { setError('Please fill in all fields.'); return; }
        setLoading(true);
        // Simulate a brief network call
        await new Promise((r) => setTimeout(r, 700));
        login({ email, name: mode === 'signup' ? name : undefined });
        setLoading(false);
        onClose();
        navigate('/chat');
    };

    const handleSocial = async (provider) => {
        setLoading(true);
        await new Promise((r) => setTimeout(r, 500));
        login({ email: `demo@${provider}.com`, name: `${provider} User` });
        setLoading(false);
        onClose();
        navigate('/chat');
    };

    const reset = () => { setEmail(''); setPassword(''); setName(''); setError(''); setLoading(false); };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="login-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                >
                    <div className="login-backdrop" onClick={onClose} />
                    <motion.div
                        className="login-modal"
                        initial={{ opacity: 0, scale: 0.96, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 8 }}
                        transition={{ duration: 0.2 }}
                    >
                        <button className="login-close" onClick={onClose} aria-label="Close">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>

                        <div className="login-header">
                            <div className="login-logo-wrapper">
                                <InteriusLogo size={40} gradient />
                            </div>
                            <h2>{mode === 'login' ? 'Welcome back' : 'Create account'}</h2>
                            <p>{mode === 'login' ? 'Sign in to continue to Interius' : 'Start building APIs with AI'}</p>
                        </div>

                        {/* Social */}
                        <div className="login-socials">
                            <button className="login-social-btn" onClick={() => handleSocial('google')} disabled={loading}>
                                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                                Continue with Google
                            </button>
                            <button className="login-social-btn" onClick={() => handleSocial('github')} disabled={loading}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33s1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z" /></svg>
                                Continue with GitHub
                            </button>
                        </div>

                        <div className="login-divider"><span>or</span></div>

                        <form className="login-form" onSubmit={handleSubmit}>
                            {mode === 'signup' && (
                                <div className="login-field">
                                    <label>Name</label>
                                    <input type="text" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
                                </div>
                            )}
                            <div className="login-field">
                                <label>Email</label>
                                <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                            </div>
                            <div className="login-field">
                                <label>Password</label>
                                <input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
                            </div>
                            {error && <p className="login-error">{error}</p>}
                            <button className="login-submit" type="submit" disabled={loading}>
                                {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
                            </button>
                        </form>

                        <div className="login-toggle">
                            {mode === 'login' ? (
                                <>Don&apos;t have an account?<button onClick={() => { setMode('signup'); reset(); }}>Sign up</button></>
                            ) : (
                                <>Already have an account?<button onClick={() => { setMode('login'); reset(); }}>Sign in</button></>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
