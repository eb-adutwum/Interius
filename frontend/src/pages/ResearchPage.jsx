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
        bgLight: "linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%)",
        bgDark: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
        textColor: "var(--text-primary)",
        codeLink: "https://github.com/NLP-Group4/Prosit1/tree/main/sectionB/final%20submission",
        content: `## Language Models and Their Use

At a fundamental level, language models are an attempt to endow machines with a workable form of linguistic competence. In human communication, understanding is revealed through some form of appropriate response: given a context, a competent speaker has expectations about what is likely, plausible, or surprising to say next. A language model adopts this same principle and formalizes it in probabilistic terms. Rather than claiming deep semantic understanding (which remains a philosophical debate), it measures comprehension through the ability to assign sensible expectations to linguistic continuations.

This intuition leads to a probabilistic formulation or model. Given a sequence of tokens $w_1, w_2, \\dots, w_T$, a language model assigns a joint probability $P(w_1, w_2, \\dots, w_T)$. The probabilities are not binary judgments of correctness, but a sort of graded sense of plausibility. For example, the sentence "I went to the bank to table the watch" should be assigned a much lower probability than "I went to the bank to sit by the river", because the latter aligns more closely with common linguistic usage and background knowledge.

Under this perspective, next-token prediction seems the smallest measurable unit of linguistic expectation. Predicting what comes next, given context, is sufficient to encode syntax, semantics, and common techniques or regularities of language usage. Training a language model, therefore, consists of adjusting its parameters to maximize the likelihood of observed text, aligning the model's internal expectations with those implicit in the natural language. 

## The Chain Rule and Maximum Likelihood

The chain rule of probability provides the crucial bridge between the abstract definition and a learnable task. It guarantees that any joint distribution over a sequence can be factored into a product of conditional distributions of the next token given the past. This factorization is an exact identity, not a modeling assumption.

$$P(w_1, \\dots, w_T) \\approx \\prod_{t=1}^T P(w_t \\mid w_{<t})$$

As a result, learning a language model is equivalent to learning the family of conditional distributions for all positions in a sequence. "Next-token prediction" is therefore not a heuristic, but the canonical decomposition of sequence modeling. Different language models differ only in how they approximate these conditional distributions. Neural language models replace explicit counts with learned representations, allowing generalization. Transformers further improve this by enabling flexible, long-range context interaction through attention.

The training objective for language models is maximum likelihood estimation, implemented as minimizing the negative log-likelihood (cross-entropy) of the true next token at each position. This loss penalizes incorrect or overconfident predictions and has a deep interpretation in information theory: good language models are good compressors.

## N-gram Models and Their Working Principles

N-gram models are among the earliest and most interpretable approaches to language modeling. They rely on the Markov assumption, which states that the probability of a token depends only on a fixed number of preceding tokens. Specifically, an n-gram model approximates the full joint distribution as:

$$P(w_1, \\dots, w_T) \\approx \\prod_{t=1}^T P(w_t \\mid w_{t-n+1}, \\dots, w_{t-1})$$

Parameter estimation in n-gram models is performed using maximum likelihood estimation (MLE). For a trigram model, the conditional probability is computed via explicit counts. However, n-gram models suffer from two fundamental limitations: a fixed short context window, and data sparsity as parameter space scales exponentially with vocabulary size.

## Handling Sparsity with Smoothing

A practical issue that arises is the problem of unseen events. Any n-gram that does not appear in the training data is assigned a probability of zero. Smoothing techniques address this by redistributing probability mass from frequent events to rare or unseen ones. While Add-k smoothing distorts dense distributions, backoff and interpolation methods yield far superior results by combining multiple context lengths simultaneously:

$$P(w_t \\mid w_{t-2}, w_{t-1}) = \\lambda_3 P(w_t \\mid w_{t-2}, w_{t-1}) + \\lambda_2 P(w_t \\mid w_{t-1}) + \\lambda_1 P(w_t)$$

Conceptually, smoothing does not alter the objective of language modeling. It allows the model to express uncertainty intelligently instead of failing outright when confronted with novel input.

## Application to Low-Resource Twi

In low-resource language modeling, the primary constraint is the mismatch between model capacity and available data. Modern neural language models typically require millions to billions of parameters, demanding tens of millions of tokens to achieve stable generalization. For African languages like Twi, establishing this corpus volume is incredibly difficult. 

Training massive neural models under such conditions often leads to severe overfitting. In contrast, n-gram language models are explicitly count-based and far more data-efficient. The theoretical parameter space scales with vocabulary size, but the observed parameter count is completely bounded by the number of unique n-grams actually present in the text.

For this study, we used monolingual Twi text extracted from the \`tw-parallel-lg-corpus\`. The final dataset exhibited typical low-resource characteristics: limited corpus size, a vocabulary of approximately 22,080 unique word types, and a highly skewed Zipfian frequency distribution with a massive tail of rare tokens. These properties introduced significant sparsity, making the modeling task particularly sensitive to data efficiency.

## Experimental Results

The best-performing model was a 4-gram Kneser-Ney language model, which achieved a validation perplexity of 110.65 and a test perplexity of 108.81. Kneser-Ney smoothing provided extremely strong inductive bias by redistributing probability mass according to continuation diversity rather than raw frequency.

Qualitative evaluation complemented the perplexity-based analysis. Lower-order models produced entirely incoherent and repetitive baseline sequences, whereas the higher-order Kneser-Ney models generated locally grammatical and contextually appropriate Twi phrases. The alignment between the strict quantitative gains and the qualitative fluency provides substantial evidence that the model successfully abstracted statistically meaningful regularities from the extremely limited dataset.`
    },
    {
        id: "medical-llm-finetuning",
        title: "Parameter-Efficient Fine-Tuning for Medical Language Models",
        excerpt: "A study on adapting DistilGPT-2 to the healthcare domain using Low-Rank Adaptation (LoRA) for specialized medical terminology understanding.",
        author: "Nicole N. Nanka-Bruce",
        date: "Feb 04, 2026",
        category: "Domain Adaptation",
        readTime: "8 min read",
        bgLight: "linear-gradient(135deg, rgba(255, 236, 210, 0.5) 0%, rgba(252, 182, 159, 0.2) 100%)",
        bgDark: "linear-gradient(135deg, rgba(255, 140, 100, 0.08) 0%, rgba(255, 100, 80, 0.02) 100%)",
        textColor: "var(--text-primary)",
        codeLink: "https://github.com/NLP-Group4/Prosit1/blob/main/sectionC/Medical_LoRA_finetuning_(NLP_Prosit1).ipynb",
        content: `## The Modern Paradigm of Domain Adaptation

While large foundation models possess unprecedented general reasoning capabilities, they lack the specific terminology, structural formatting, and factual grounding required for highly specialized fields such as healthcare. General-purpose models often fail to provide granular, clinically sound advice without explicit domain adaptation. MedicalLM addresses this critical gap.

We developed MedicalLM, a parameter-efficient, domain-specific language model explicitly targeting the healthcare sector. Healthcare represents a high-stakes domain where precise natural language understanding and generation are non-negotiable.

## Fine-Tuning Constraints and LoRA

The transition from a generalized model to a specialized medical assistant historically required "full fine-tuning"—updating every single parameter in the neural network. This traditional approach, while effective, demands immense computational clustering and risks "catastrophic forgetting," where the model overwrites its foundational English grammar to memorize domain terminology.

Due to severe memory constraints targeting consumer-grade GPU hardware, we utilized Low-Rank Adaptation (LoRA) without quantization on the \`DistilGPT-2\` architecture (82M parameters). LoRA functions by freezing the core pre-trained weights of the model and injecting incredibly small, trainable adapter matrices into the specific attention layers.

This modern parameter-efficient paradigm allowed us to drastically cut down backpropagation costs. Only a minute fraction of the model's total parameters were updated during the process, maintaining extreme computational efficiency while retaining the base language modeling prowess.

## The Biomedical Corpus

To facilitate the adaptation, we sourced a dense corpus of medical abstracts from Hugging Face (\`TimSchopf/medical_abstracts\`). This dataset features thousands of authentic biomedical literature excerpts filled with highly specialized, hyper-localized terminology that base models ordinarily misinterpret or ignore.

The data was structured into an instructional format to prevent the base model from hallucinating unexpected completions. By explicitly delineating the prompt from the response, MedicalLM was taught the syntactical boundaries of clinical queries versus clinical answers.

## Hyperparameter Experimentation

We executed systematic, rigorous experimentation across multiple training configurations, varying the learning rate, rank (adapter capacity), and total epochs. 

A critical observation arose: higher LoRA rank ($r=16$) did not consistently improve results. Given the relatively small size of \`DistilGPT-2\`, the model was too compact to effectively leverage the increased adapter capacity. Lower learning rates (e.g., $5e^{-5}$) proved far more stable across epochs. The ultimate optimal configuration settled on a rank of $8$, an alpha of $32$, and $5$ epochs of training.

## Quantitative Divergence and Results

MedicalLM exhibited a steady and clear improvement across core training metrics. Training loss dropped linearly, and the initial validation perplexity improved from an initial $24.83$ to a final $23.42$ (a $5.7\\%$ improvement). Top-1 token prediction accuracy increased across the board.

However, we encountered a fundamental trade-off: **test perplexity worsened by over $60\\%$** despite the accuracy gains. This metric divergence revealed a core principle of domain adaptation — the fine-tuned model became hyper-specialized. It grew incredibly adept at prioritizing exactly the right medical tokens (hence the accuracy jump), but its general probability distribution became slightly distorted overall, driving up raw perplexity. Evaluating domain-specific models ultimately demands multiple complementary metrics.

## Qualitative Improvements

Qualitatively, the model produced stark, remarkable improvements. Prior to fine-tuning, the baseline \`DistilGPT-2\` model frequently deteriorated into repetitive, looping nonsense when presented with complex clinical prompts. 

Following the LoRA adaptation, MedicalLM produced accurate, coherent, and rigorously domain-appropriate biomedical text. It correctly utilized specialized terminology strictly within the appropriate context, diagnosing complex symptoms and refusing to hallucinate broad assertions, proving that parameter-efficient fine-tuning is exceptionally viable for medical AI.`
    },
    {
        id: "agricgpt-instruction-tuning",
        title: "AgricGPT: Instruction Tuning for the Agricultural Domain",
        excerpt: "Leveraging QLoRA on a 2.7B parameter model to provide domain-specific agricultural guidance on sustainable farming practices.",
        author: "Joseph A. Ajegetina",
        date: "Feb 04, 2026",
        category: "Instruction Tuning",
        readTime: "9 min read",
        bgLight: "linear-gradient(135deg, rgba(212, 252, 121, 0.3) 0%, rgba(150, 230, 161, 0.2) 100%)",
        bgDark: "linear-gradient(135deg, rgba(150, 250, 120, 0.08) 0%, rgba(100, 200, 100, 0.02) 100%)",
        textColor: "var(--text-primary)",
        codeLink: "https://github.com/NLP-Group4/Prosit1/blob/main/sectionC/agricgpt.ipynb",
        content: `## AI for Sustainable Agriculture

The agricultural sector represents one of the most critical domains for applied artificial intelligence, directly impacting global food security, climate resistance, and economic stability in developing regions. Despite this, general-purpose Large Language Models (LLMs) frequently fail to dispense accurate, scientifically grounded agricultural advice. When asked complex questions regarding soil health or pest mitigation, base models tend to hallucinate generalized treatments that are practically useless to working farmers.

To combat this, we engineered **AgricGPT**, a heavily domain-specific language model trained explicitly to provide granular, actionable agricultural guidance on crop management, pest control, and sustainable farming methodologies.

## Quantized Low-Rank Adaptation (QLoRA)

To achieve high-quality domain adaptation without requiring enterprise supercomputing clusters, we employed the Quantized Low-Rank Adaptation (QLoRA) methodology paired with Microsoft's \`Phi-2\` base model, which boasts an incredibly dense 2.7 Billion parameters.

QLoRA is a breakthrough in parameter-efficient fine-tuning. It utilizes aggressive 4-bit precision quantization to freeze the fundamental weights of the \`Phi-2\` model, slashing memory requirements by approximately $75\\%$. Instead of updating the massive core network, training is entirely restricted to specialized, low-rank adapter matrices integrated into the attention layers.

By taking this route, **only $1.53\\%$ of the parameters were actively trainable** ($23.6M$ parameters out of the total $1.54B$). This process was astonishingly efficient, allowing us to adapt a massive neural network on consumer-grade hardware without triggering catastrophic forgetting of natural English syntax.

## The AI4Agr Dataset

AgricGPT was fine-tuned leveraging the \`AI4Agr/CROP-dataset\`. We filtered the corpus to extract roughly 5,000 highly structured, English-language instructional samples, partitioned into a strict $90\\% / 10\\%$ train and validation split. 

Crucially, the data was coerced into an instruction-following template. We explicitly defined boundaries:
1. **Instruction:** The query from the farmer.
2. **Response:** The technical, scientifically backed solution.

Without this templating, base models routinely fail to answer the question, instead attempting to endlessly autocomplete the prompt itself. Instruction tuning forcefully aligns the model's output to the user's intent.

## Model Evaluation and Trajectory

During the fine-tuning phase, AgricGPT showcased massive, continuous improvement. We observed a drastic reduction in training loss, plummeting from $2.05$ to $0.71$ — a spectacular $65\\%$ efficiency gain. Validation loss mirrored this trajectory, falling gracefully to $0.99$ without demonstrating signs of overfitting.

To evaluate genuine world knowledge, we subjected the model to the rigorous \`CROP-benchmark\`, an official dataset of 500 domain-specific questions scaling across varying difficulty levels. AgricGPT elevated its baseline accuracy from $73.2\\%$ to a staggering **$82.2\\%$**, claiming a massive $+9$ percentage point improvement over its un-tuned predecessor.

When evaluating performance by difficulty, the model achieved nearly perfect scores on "Easy" formulations ($95.6\\%$) and incredibly robust results on "Medium" questions ($85.4\\%$). Hard reasoning questions remained difficult, highlighting an avenue for future development.

## Qualitative Eradication of Hallucinations

The true success of AgricGPT lay in its qualitative responses. When the baseline \`Phi-2\` model was fed prompts regarding mysterious gray-to-brown spots on maize leaves, it consistently misdiagnosed the ailment as "maize streak virus"—a completely incorrect assessment—and proceeded to hallucinate unrelated advice.

Conversely, the fine-tuned AgricGPT correctly and definitively identified the exact symptoms as **Gray Leaf Spot**, a fungal disease. It then provided immediately actionable interventions, accurately recommending applications of specific fungicides such as propiconazole or tricyclazole, and ended the dialogue by advising the farmer on proper chemical rotation to prevent resistance buildup. This proves conclusively that QLoRA can embed deeply specialized, life-saving domain knowledge into massive LLMs.`
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
                                background: theme === 'dark' ? post.bgDark : post.bgLight,
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
