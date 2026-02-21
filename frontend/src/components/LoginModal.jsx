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

    const { signIn, signUp, signInWithOAuth } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!email || !password) { setError('Please fill in all fields.'); return; }
        if (mode === 'signup' && !name) { setError('Please provide your name.'); return; }

        setLoading(true);
        try {
            if (mode === 'signup') {
                await signUp(email, password, name);
            } else {
                await signIn(email, password);
            }
            onClose();
            navigate('/chat');
        } catch (err) {
            setError(err.message || 'Authentication failed');
        } finally {
            setLoading(false);
        }
    };

    const handleSocial = async (provider) => {
        setLoading(true);
        try {
            await signInWithOAuth(provider);
        } catch (err) {
            setError(err.message || 'Authentication failed');
            setLoading(false);
        }
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
                                <img src="/mini.svg" alt="Interius" width={40} />
                            </div>
                            <h2>{mode === 'login' ? 'Welcome back' : 'Create account'}</h2>
                            <p>{mode === 'login' ? 'Sign in to continue to Interius' : 'Start building APIs with AI'}</p>
                        </div>


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
                            {error && (
                                <div className="login-error">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                                    {error}
                                </div>
                            )}
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
