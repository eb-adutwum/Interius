import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LandingPage from './pages/LandingPage';
import ChatPage from './pages/ChatPage';
import './App.css';

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/" replace />;
}

function AppRoutes() {
  const [loginOpen, setLoginOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('interius-theme') || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('interius-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((p) => (p === 'dark' ? 'light' : 'dark'));

  return (
    <Routes>
      <Route
        path="/"
        element={
          <LandingPage
            loginOpen={loginOpen}
            setLoginOpen={setLoginOpen}
            theme={theme}
            onThemeToggle={toggleTheme}
          />
        }
      />
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <ChatPage theme={theme} onThemeToggle={toggleTheme} />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
