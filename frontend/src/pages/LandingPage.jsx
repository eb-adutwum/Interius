import Navbar from '../components/Navbar';
import Hero from '../components/Hero';
import DemoSection from '../components/DemoSection';
import Features from '../components/Features';
import Waitlist from '../components/Waitlist';
import Footer from '../components/Footer';
import LoginModal from '../components/LoginModal';

export default function LandingPage({ loginOpen, setLoginOpen, theme, onThemeToggle }) {
    return (
        <>
            <Navbar onLoginClick={() => setLoginOpen(true)} theme={theme} onThemeToggle={onThemeToggle} />
            <Hero onTryClick={() => setLoginOpen(true)} />
            <DemoSection onOpenLogin={() => setLoginOpen(true)} />
            <Features onTryApp={() => setLoginOpen(true)} />
            <Waitlist onTryApp={() => setLoginOpen(true)} />
            <Footer />
            <LoginModal isOpen={loginOpen} onClose={() => setLoginOpen(false)} />
        </>
    );
}
