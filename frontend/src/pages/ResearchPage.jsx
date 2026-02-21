import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export const RESEARCH_POSTS = [
    {
        id: "language-models-and-twi",
        title: "Language Models and Competence: N-gram Models for Twi",
        excerpt: "An exploration into the operational definition of language models, the chain rule of probability, and their application to a low-resource African language.",
        author: "Elijah K. A. Boateng, Innocent F. Chikwanda",
        date: "Feb 04, 2026",
        category: "Natural Language Processing",
        readTime: "12 min read",
        bgConfig: "linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%)", // Very subtle grey
        textColor: "var(--text-primary)",
        content: `LANGUAGE MODELS: AN OPERATIONAL DEFINITION

A language model (LM) is defined, in NLP, as a probability distribution over sequences of tokens. This definition is not claiming that language understanding is probability; rather, it is an operational definition chosen because it captures all observable linguistic competence in a precise and testable way.

Language understanding, from a scientific perspective, is not defined by internal mental states but by behavior: the ability to judge, produce, and respond to language appropriately across contexts. Human language use is inherently uncertain and non-deterministic: given the same prefix, many continuations are possible, but not equally plausible. Understanding language therefore involves having the right expectations about what is likely, unlikely, or inappropriate in context. Probability is the mathematical formalism that encodes graded expectations.

Formally, defining a distribution over sequences means assigning higher probability to fluent, meaningful, and contextually appropriate utterances, and lower probability to incoherent or implausible ones. This is sufficient to recover the core abilities we associate with linguistic competence: grammaticality judgments, semantic compatibility, long-range coherence, ambiguity resolution, and appropriate responses to questions or instructions. Generation is a consequence of having such a distribution, not the definition itself.

THE CHAIN RULE AND MAXIMUM LIKELIHOOD

The chain rule of probability provides the crucial bridge between the abstract definition and a learnable task. It guarantees that any joint distribution over a sequence can be factored into a product of conditional distributions of the next token given the past. This factorization is an exact identity, not a modeling assumption. As a result, learning a language model is equivalent to learning the family of conditional distributions P(w_t | w_{<t}) for all positions in a sequence. "Next-token prediction" is therefore not a heuristic, but the canonical decomposition of sequence modeling.

Different language models differ only in how they approximate these conditional distributions. n-gram models do so by making a Markov assumption and estimating probabilities via counts, which leads to sparsity and limited context. Neural language models replace explicit counts with learned representations, allowing generalization. Transformers further improve this by enabling flexible, long-range context interaction through attention. Across all these models, the probabilistic objective remains the same.

The training objective for language models is maximum likelihood estimation, implemented as minimizing the negative log-likelihood (cross-entropy) of the true next token at each position. This loss penalizes incorrect or overconfident predictions and has a deep interpretation in information theory: good language models are good compressors, because they assign short codes to likely sequences and long codes to unlikely ones.

Crucially, grammar alone is insufficient for language understanding. Meaning, in NLP, is not explicitly defined but emerges as the set of constraints that shape which sequences occur and how often.

APPLICATION TO LOW-RESOURCE TWI

In low-resource language modeling, the primary constraint is the mismatch between model capacity and available data. For our study, we used monolingual Twi text extracted from the tw-parallel-lg-corpus. We opted for n-gram language models, which are explicitly count-based and far more data-efficient than massive neural transformers that demand tens of millions of tokens to prevent overfitting.

The best-performing model was a 4-gram Kneser-Ney language model, achieving a validation perplexity of 110.65 and a test perplexity of 108.81. The alignment between quantitative improvements and qualitative fluency provides strong evidence that the model learned statistically meaningful regularities from the limited data.`
    },
    {
        id: "medical-llm-finetuning",
        title: "Parameter-Efficient Fine-Tuning for Medical Language Models",
        excerpt: "A study on adapting DistilGPT-2 to the healthcare domain using Low-Rank Adaptation (LoRA) for specialized medical terminology understanding.",
        author: "Nicole N. Nanka-Bruce",
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
    },
    {
        id: "agricgpt-instruction-tuning",
        title: "AgricGPT: Instruction Tuning for the Agricultural Domain",
        excerpt: "Leveraging QLoRA on a 2.7B parameter model to provide domain-specific agricultural guidance on sustainable farming practices.",
        author: "Joseph A. Ajegetina",
        date: "Feb 04, 2026",
        category: "Instruction Tuning",
        readTime: "9 min read",
        bgConfig: "linear-gradient(135deg, rgba(212, 252, 121, 0.3) 0%, rgba(150, 230, 161, 0.2) 100%)", // Very subtle green
        textColor: "var(--text-primary)",
        content: `INTRODUCTION

We built AgricGPT, a domain-specific model targeting agriculture—a domain selected for its profound practical impact on food security in developing regions. General-purpose models often fail to provide granular, contextually sound advice regarding crop management or sustainable farming practices.

AgricGPT leverages the AI4Agr/CROP-dataset, containing instruction-response pairs about crop management, pest control, soil health, and sustainable farming. We selected 5,000 English samples with a 90%/10% train/validation split.

FINE-TUNING VIA QLORA

We chose QLoRA (Quantized Low-Rank Adaptation) paired with the Microsoft Phi-2 (2.7B parameters) base model. This decision was driven by practical constraints: QLoRA enables training on consumer GPUs by reducing memory requirements by approximately 75% through 4-bit quantization. 

Only 1.53% of parameters were trainable (23.6M out of 1.54B), making the process highly efficient while avoiding catastrophic forgetting of the model's fundamental English syntax. 

EVALUATION AND FINDINGS

The model was subjected to an instruction-following template that explicitly structures prompts to solicit domain-specific agricultural responses rather than completing free-form text. 

AgricGPT showed substantial improvement throughout training:
- Training loss decreased from 2.05 to 0.71 (a 65% reduction).
- Validation loss decreased from 1.36 to 0.99.
- CROP-benchmark accuracy improved significantly, gaining +9 percentage points (from 73.2% to 82.2%).

Qualitatively, while the baseline Phi-2 model often responded to agricultural queries with generic or hallucinated treatments (e.g., misdiagnosing fungal leaf spots as a streak virus), the fine-tuned AgricGPT correctly identified symptoms and recommended specific, actionable interventions like applying propiconazole.`
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
