import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link, NavLink } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';
import './Navbar.css';

export default function Navbar({ onLoginClick, theme, onThemeToggle }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.nav
      className={`navbar${scrolled ? ' scrolled' : ''}`}
      initial={{ y: -56 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="navbar-inner">
        <Link to="/" className="navbar-logo">
          Interius<span className="logo-period">.</span>
        </Link>
        <div className="navbar-links" aria-label="Primary">
          <NavLink
            to="/about"
            className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
          >
            About
          </NavLink>
          <NavLink
            to="/cli"
            className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
          >
            CLI Guide
          </NavLink>
          <NavLink
            to="/research"
            className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
          >
            Research
          </NavLink>
        </div>
        <div className="navbar-actions">
          <ThemeToggle theme={theme} onToggle={onThemeToggle} />
          <button className="navbar-login" onClick={onLoginClick}>Log in</button>
        </div>
      </div>
    </motion.nav>
  );
}
