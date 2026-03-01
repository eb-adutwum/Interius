import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ScrollToTop from './components/ScrollToTop';
import { AuthProvider, useAuth } from './context/AuthContext';
import LandingPage from './pages/LandingPage';
import ChatPage from './pages/ChatPage';
import DocsPage from './pages/DocsPage';
import ApiReferencePage from './pages/ApiReferencePage';
import CliGuidePage from './pages/CliGuidePage';
import AboutPage from './pages/AboutPage';
import ResearchPage from './pages/ResearchPage';
import ResearchPostPage from './pages/ResearchPostPage';
import LoginModal from './components/LoginModal';
import './App.css';

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/" replace />;
}

function AppRoutes() {
  const { user } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('interius-theme') || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('interius-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((p) => (p === 'dark' ? 'light' : 'dark'));

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            user ? (
              <Navigate to="/chat" replace />
            ) : (
              <LandingPage
                loginOpen={loginOpen}
                setLoginOpen={setLoginOpen}
                theme={theme}
                onThemeToggle={toggleTheme}
              />
            )
          }
        />
        <Route
          path="/chat/:threadId?"
          element={
            <ProtectedRoute>
              <ChatPage theme={theme} onThemeToggle={toggleTheme} />
            </ProtectedRoute>
          }
        />
        <Route path="/docs" element={<DocsPage onOpenLogin={() => setLoginOpen(true)} theme={theme} onThemeToggle={toggleTheme} />} />
        <Route path="/api" element={<ApiReferencePage onOpenLogin={() => setLoginOpen(true)} theme={theme} onThemeToggle={toggleTheme} />} />
        <Route path="/cli" element={<CliGuidePage onOpenLogin={() => setLoginOpen(true)} theme={theme} onThemeToggle={toggleTheme} />} />
        <Route path="/about" element={<AboutPage onOpenLogin={() => setLoginOpen(true)} theme={theme} onThemeToggle={toggleTheme} />} />
        <Route path="/research" element={<ResearchPage onOpenLogin={() => setLoginOpen(true)} theme={theme} onThemeToggle={toggleTheme} />} />
        <Route path="/research/:id" element={<ResearchPostPage onOpenLogin={() => setLoginOpen(true)} theme={theme} onThemeToggle={toggleTheme} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <LoginModal isOpen={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
