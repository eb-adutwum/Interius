import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export const RESEARCH_POSTS = [
    {
        id: "n-grams-for-twi",
        title: "Low-Resource African Language Modeling: N-gram Models for Twi",
        excerpt: "An exploration into building data-efficient language models for Twi using n-gram architectures and Kneser-Ney smoothing.",
        author: "Elijah K. A. Boateng, Nicole N. Nanka-Bruce, Joseph A. Ajegetina",
        date: "Feb 04, 2026",
        category: "Natural Language Processing",
        readTime: "10 min read",
        bgConfig: "linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%)", // Very subtle grey
        textColor: "var(--text-primary)",
        content: `INTRODUCTION

In low-resource language modeling, the primary constraint is the mismatch between model capacity and available data. Modern neural language models, including recurrent architectures and transformers, contain millions of parameters that must be estimated from data. Empirical scaling laws demonstrate that effective neural language model training typically requires between 10 and 100 tokens per parameter to achieve stable generalization. Even relatively small transformer architectures therefore demand tens of millions of tokens, far exceeding the size of the available corpora for most African languages, including Twi.

Training neural models under such conditions often leads to overfitting, unstable optimization, and misleading performance metrics.

METHODOLOGY

For this study, we used monolingual Twi text extracted from the tw-parallel-lg-corpus. The final dataset exhibited typical low-resource characteristics: limited corpus size, a vocabulary of approximately 22,080 unique word types, and a highly skewed frequency distribution with a long tail of rare tokens.

We opted for n-gram language models, which are explicitly count-based and far more data-efficient. The theoretical parameter space of an n-gram model scales exponentially with vocabulary size, but the observed parameter count is bounded by the number of n-grams actually present in the corpus. Crucially, we applied advanced smoothing techniques—particularly Kneser-Ney smoothing—which provides strong inductive bias by redistributing probability mass according to continuation diversity rather than raw frequency.

RESULTS

The best-performing model was a 4-gram Kneser-Ney language model, achieving a validation perplexity of 110.65 and a test perplexity of 108.81, confirming strong generalization. 

Qualitative evaluation complemented perplexity-based analysis. Lower-order models produced incoherent and repetitive sequences, whereas the higher-order Kneser-Ney models generated locally grammatical and contextually appropriate phrases. The alignment between quantitative improvements and qualitative fluency provides strong evidence that the model learned statistically meaningful regularities from the limited data.`
    },
    {
        id: "medical-llm-finetuning",
        title: "Parameter-Efficient Fine-Tuning for Medical Language Models",
        excerpt: "A study on adapting DistilGPT-2 to the healthcare domain using Low-Rank Adaptation (LoRA) for specialized medical terminology understanding.",
        author: "Nicole N. Nanka-Bruce, Joseph A. Ajegetina, Elijah K. A. Boateng",
        date: "Feb 04, 2026",
        category: "Domain Adaptation",
        readTime: "8 min read",
        bgConfig: "linear-gradient(135deg, rgba(255, 236, 210, 0.5) 0%, rgba(252, 182, 159, 0.2) 100%)", // Very subtle warm
        textColor: "var(--text-primary)",
        content: `INTRODUCTION

We developed MedicalLM, a domain-specific language model targeting the healthcare sector. Healthcare represents a high-stakes domain where specialized language understanding is critical.

General-purpose foundation models often lack the precise terminology and reasoning required for medical literature without explicit domain adaptation. MedicalLM uses medical abstracts sourced from Hugging Face featuring biomedical literature with highly specialized terminology.

FINE-TUNING APPROACH

We considered various fine-tuning approaches for developing our domain-specific English model. Due to memory constraints and out-of-memory errors that prevented full fine-tuning, we utilized Low-Rank Adaptation (LoRA) without quantization on DistilGPT-2 (82M parameters). 

This modern, parameter-efficient approach enabled systematic hyperparameter experimentation and provided a meaningful comparison on text generation tasks while maintaining extreme computational efficiency. Only a small fraction of the parameters were updated by injecting low-rank adapter matrices.

EXPERIMENTS AND RESULTS

We conducted systematic experimentation across multiple configurations, varying the learning rate, rank, and epochs. The best configuration used a rank of 8, an alpha of 32, a learning rate of 5e-5, and 5 epochs. A key insight emerged: higher rank did not improve results, as DistilGPT-2 is too small to benefit from increased adapter capacity. Lower learning rates proved more stable.

MedicalLM exhibited consistent improvement throughout training. Validation perplexity improved from an initial 24.83 to 23.42 (a 5.7% improvement).

Qualitatively, the model showed stark improvements. While the baseline DistilGPT-2 frequently deteriorated into repetitive or looping text when presented with clinical prompts, the fine-tuned MedicalLM produced accurate, coherent, and domain-appropriate biomedical text, correctly using specialized terminology in context.`
    }
];

export default function ResearchPage({ onOpenLogin, theme, onThemeToggle }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg-primary)' }}>
            <Navbar onLoginClick={onOpenLogin} theme={theme} onThemeToggle={onThemeToggle} />

            <main style={{ flex: 1, padding: '120px 20px', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
                <header style={{ textAlign: 'center', marginBottom: '80px' }}>
                    <h1 style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', fontWeight: '700', letterSpacing: '-0.03em', marginBottom: '20px' }}>
                        Our Research
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '1.2rem', maxWidth: '600px', margin: '0 auto' }}>
                        Scientific discourse, technical deep dives, and academic perspectives on the frontiers of artificial intelligence and distributed systems.
                    </p>
                </header>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '30px' }}>
                    {RESEARCH_POSTS.map(post => (
                        <Link to={`/research/${post.id}`} key={post.id} style={{ textDecoration: 'none' }}>
                            <article style={{
                                background: post.bgConfig,
                                aspectRatio: '1',
                                borderRadius: '12px',
                                padding: '36px',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'flex-start',
                                transition: 'opacity 0.2s ease',
                                cursor: 'pointer',
                                color: post.textColor,
                                position: 'relative',
                                overflow: 'hidden'
                            }}
                                onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                            >
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '0.8rem', fontWeight: '500', color: 'var(--text-secondary)', letterSpacing: '0.02em', textTransform: 'uppercase', marginBottom: '16px' }}>
                                        {post.category} • {post.date}
                                    </div>
                                    <h2 style={{ fontSize: '1.35rem', lineHeight: '1.4', fontWeight: '600', letterSpacing: '-0.01em', marginBottom: '16px' }}>
                                        {post.title}
                                    </h2>
                                    <p style={{ fontSize: '0.95rem', lineHeight: '1.5', color: 'var(--text-secondary)', opacity: 0.9 }}>
                                        {post.excerpt.length > 120 ? post.excerpt.substring(0, 120) + '...' : post.excerpt}
                                    </p>
                                </div>
                                <div style={{ fontSize: '0.95rem', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>
                                        {post.author.charAt(0)}
                                    </div>
                                    {post.author}
                                </div>
                            </article>
                        </Link>
                    ))}
                </div>
            </main>

            <Footer />
        </div>
    );
}
