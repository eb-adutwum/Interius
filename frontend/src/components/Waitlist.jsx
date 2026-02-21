import { motion } from 'framer-motion';
import './Waitlist.css';

export default function Waitlist({ onTryApp }) {
    return (
        <section className="cta-section" id="waitlist">
            <div className="cta-gradient" />
            <div className="container cta-content">
                <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5 }}
                >
                    Try Interius
                </motion.h2>
                <motion.p
                    initial={{ opacity: 0, y: 15 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.1, duration: 0.5 }}
                >
                    Start building backend APIs with AI, the app is free to try.
                </motion.p>
                <motion.div
                    className="cta-actions"
                    initial={{ opacity: 0, y: 15 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.2, duration: 0.5 }}
                >
                    <button className="btn-primary" onClick={onTryApp}>
                        Try the app, it's free
                    </button>
                    <button className="btn-secondary">
                        Join the IDE waitlist
                    </button>
                </motion.div>
            </div>
        </section>
    );
}
