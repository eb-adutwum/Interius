import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { motion } from 'framer-motion';

const TEAM = [
    {
        name: "Nicole N. Nanka-Bruce",
        role: "Research Engineer",
        image: "/team/nicole.png",
        bio: "Specializes in multiagent orchestration and post-training."
    },
    {
        name: "Joseph A. Ajegetina",
        role: "Research Engineer",
        image: "/team/joseph.png",
        bio: "Architects scalable distributed systems and specializes in AI alignment."
    },
    {
        name: "Innocent F. Chikwanda",
        role: "Research Engineer",
        image: "/team/innocent.png",
        bio: "Expert in Retrieval-Augmented Generation and agent evaluation."
    },
    {
        name: "Elijah K. A. Boateng",
        role: "Research Engineer",
        image: "/team/elijah.png",
        bio: "Specializes in reasoning and planning mechanisms for autonomous agents."
    }
];

export default function AboutPage({ onOpenLogin, theme, onThemeToggle }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', position: 'relative', overflow: 'hidden' }}>
            {/* Subtle Page Background Orbits */}
            <motion.div
                animate={{
                    x: [0, 100, -50, 0],
                    y: [0, -50, 100, 0],
                }}
                transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
                style={{
                    position: 'absolute',
                    top: '-10%',
                    left: '-10%',
                    width: '600px',
                    height: '600px',
                    background: 'radial-gradient(circle, rgba(56, 189, 248, 0.05) 0%, rgba(0,0,0,0) 70%)',
                    borderRadius: '50%',
                    zIndex: 0,
                    pointerEvents: 'none'
                }}
            />
            <motion.div
                animate={{
                    x: [0, -100, 50, 0],
                    y: [0, 50, -100, 0],
                }}
                transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
                style={{
                    position: 'absolute',
                    bottom: '-10%',
                    right: '-10%',
                    width: '800px',
                    height: '800px',
                    background: 'radial-gradient(circle, rgba(139, 92, 246, 0.04) 0%, rgba(0,0,0,0) 70%)',
                    borderRadius: '50%',
                    zIndex: 0,
                    pointerEvents: 'none'
                }}
            />

            <Navbar onLoginClick={onOpenLogin} theme={theme} onThemeToggle={onThemeToggle} />

            <main style={{ flex: 1, padding: '120px 20px', maxWidth: '1200px', margin: '0 auto', width: '100%', position: 'relative', zIndex: 1 }}>
                <header style={{ textAlign: 'center', marginBottom: '100px' }}>
                    <h1 style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', fontWeight: '700', letterSpacing: '-0.03em', marginBottom: '20px' }}>
                        About Interius
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', maxWidth: '750px', margin: '0 auto', lineHeight: '1.6' }}>
                        We are an African AI technology startup founded by four engineers and researchers from Ashesi University, dedicated to building autonomous infrastructure to orchestrate, accelerate, and redefine software development.
                    </p>
                </header>

                {/* Creative Side-by-Side Section for Non-Developer API Platform */}
                <section style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '60px',
                    marginBottom: '140px',
                    width: '100%'
                }}>
                    <div style={{ flex: 1, maxWidth: '500px' }}>
                        <h2 style={{ fontSize: '2rem', fontWeight: '700', letterSpacing: '-0.02em', marginBottom: '24px', lineHeight: '1.2' }}>
                            Building a Non-Developer Friendly API Development Platform
                        </h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', lineHeight: '1.6', margin: 0 }}>
                                Interius abstracts away the complexities of backend engineering. You don’t need to write boilerplate code or configure intricate database schemas manually.
                            </p>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', lineHeight: '1.6', margin: 0 }}>
                                Simply describe your data models and endpoints in plain English using natural language, and our autonomous multi-agent architecture instantly provisions, deploys, and scales your robust API infrastructure.
                            </p>
                        </div>
                    </div>

                    <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                        <div style={{
                            position: 'relative',
                            width: '100%',
                            maxWidth: '600px',
                            minHeight: '320px',
                            background: 'var(--bg-secondary)',
                            borderRadius: '24px',
                            border: '1px solid var(--border-subtle)',
                            boxShadow: 'var(--shadow-xl), 0 20px 40px -10px rgba(56, 189, 248, 0.1)',
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            isolation: 'isolate'
                        }}>
                            {/* Moving Abstract Gradients (Bluish Mix) */}
                            <motion.div
                                animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 0] }}
                                transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
                                style={{
                                    position: 'absolute',
                                    top: '20%',
                                    left: '10%',
                                    width: '240px',
                                    height: '240px',
                                    background: 'radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, rgba(0,0,0,0) 70%)',
                                    filter: 'blur(40px)',
                                    borderRadius: '50%',
                                    zIndex: 0
                                }}
                            />
                            <motion.div
                                animate={{ scale: [1, 1.5, 1], rotate: [0, -90, 0] }}
                                transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
                                style={{
                                    position: 'absolute',
                                    bottom: '10%',
                                    right: '10%',
                                    width: '200px',
                                    height: '200px',
                                    background: 'radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, rgba(0,0,0,0) 70%)',
                                    filter: 'blur(40px)',
                                    borderRadius: '50%',
                                    zIndex: 0
                                }}
                            />

                            {/* Abstract Interface / Visualization */}
                            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: '20px', width: '90%', margin: '40px 0' }}>
                                {/* Mock Chat Input */}
                                <motion.div
                                    initial={{ y: 20, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ duration: 0.8, delay: 0.2 }}
                                    style={{
                                        background: 'rgba(255, 255, 255, 0.03)',
                                        backdropFilter: 'blur(10px)',
                                        border: '1px solid var(--border-subtle)',
                                        padding: '14px 20px',
                                        borderRadius: '16px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        boxShadow: 'var(--shadow-md)'
                                    }}>
                                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-green), #38bdf8)' }} />
                                    <div style={{ color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: '500' }}>
                                        "Create a secure healthcare scheduling API"
                                    </div>
                                </motion.div>

                                {/* Connecting Line */}
                                <div style={{ height: '24px', borderLeft: '2px dashed var(--border-subtle)', marginLeft: '32px' }} />

                                {/* Mock Endpoint Card */}
                                <motion.div
                                    initial={{ y: 20, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ duration: 0.8, delay: 0.6 }}
                                    style={{
                                        background: 'var(--bg-primary)',
                                        border: '1px solid var(--border-subtle)',
                                        padding: '20px',
                                        borderRadius: '20px',
                                        boxShadow: 'var(--shadow-lg)'
                                    }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                        <span style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-green)', padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '700', fontFamily: 'var(--font-mono)' }}>
                                            POST
                                        </span>
                                        <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
                                            /api/v1/appointments
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        <div style={{ height: '8px', width: '100%', background: 'var(--bg-secondary)', borderRadius: '4px' }} />
                                        <div style={{ height: '8px', width: '60%', background: 'var(--bg-secondary)', borderRadius: '4px' }} />
                                        <div style={{ height: '8px', width: '80%', background: 'var(--bg-secondary)', borderRadius: '4px' }} />
                                    </div>
                                </motion.div>
                            </div>
                        </div>
                    </div>
                </section>

                <section style={{ maxWidth: '1000px', margin: '0 auto' }}>
                    <h2 style={{ fontSize: '2rem', fontWeight: '600', letterSpacing: '-0.02em', marginBottom: '50px', textAlign: 'center' }}>Meet the Team</h2>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: '24px'
                    }}>
                        {TEAM.map((member, idx) => (
                            <div key={idx} style={{ textAlign: 'center' }}>
                                <div style={{
                                    width: '140px',
                                    height: '140px',
                                    margin: '0 auto 20px',
                                    borderRadius: '50%',
                                    overflow: 'hidden',
                                    border: '3px solid var(--bg-secondary)',
                                    boxShadow: 'var(--shadow-md)',
                                    background: 'var(--border-subtle)'
                                }}>
                                    <img
                                        src={member.image}
                                        alt={member.name}
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        onError={(e) => {
                                            e.target.onerror = null;
                                            e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(member.name)}&background=random&size=200`;
                                        }}
                                    />
                                </div>
                                <h3 style={{ fontSize: '1.05rem', fontWeight: '600', marginBottom: '4px' }}>{member.name}</h3>
                                <div style={{ color: 'var(--accent-green)', fontSize: '0.9rem', fontWeight: '500', marginBottom: '12px' }}>{member.role}</div>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5' }}>
                                    {member.bio}
                                </p>
                            </div>
                        ))}
                    </div>
                </section>

                <div style={{ width: '100%', height: '1px', background: 'var(--border-subtle)', margin: '80px 0' }} />

                <section style={{ marginBottom: '60px', maxWidth: '1000px', margin: '0 auto 60px' }}>
                    <div style={{ textAlign: 'center', marginBottom: '50px' }}>
                        <h2 style={{ fontSize: '1.8rem', fontWeight: '600', letterSpacing: '-0.02em', marginBottom: '16px', color: 'var(--text-primary)' }}>Featured roles</h2>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', maxWidth: '600px', margin: '0 auto', lineHeight: '1.6' }}>
                            We are actively seeking talented individuals to join our team. Explore featured roles below.
                        </p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {[
                            { title: "Research Intern, Agents", department: "Research", location: "Remote" },
                            { title: "Research Intern, Foundations", department: "Research", location: "Remote" },
                            { title: "Security Engineer", department: "Engineering", location: "Accra, Ghana" },
                            { title: "Security Researcher", department: "Research", location: "Accra, Ghana" },
                            { title: "Backend Engineer, Interius IDE", department: "Engineering", location: "Berekuso (Hybrid)" },
                        ].map((role, idx) => (
                            <div key={idx} style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '24px 0',
                                borderBottom: '1px solid var(--border-subtle)',
                                borderTop: idx === 0 ? '1px solid var(--border-subtle)' : 'none',
                                cursor: 'pointer',
                                transition: 'border-color 0.2s',
                            }}
                                onMouseEnter={e => e.currentTarget.style.borderBottomColor = 'var(--text-primary)'}
                                onMouseLeave={e => e.currentTarget.style.borderBottomColor = 'var(--border-subtle)'}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <span style={{ fontSize: '0.9rem', fontWeight: '500', color: 'var(--text-primary)' }}>{role.title}</span>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', opacity: 0.6 }}>{role.department}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{role.location}</span>
                                    <span style={{ fontSize: '0.85rem', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-primary)' }}>
                                        Apply now <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17l9.2-9.2M17 17V7H7" /></svg>
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </main>

            <Footer />
        </div>
    );
}
