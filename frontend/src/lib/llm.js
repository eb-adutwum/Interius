export async function generateThreadTitle(prompt) {
    const apiKey = import.meta.env.VITE_GROQ_API_KEY;

    if (!apiKey) {
        console.warn('No Groq API key provided. Falling back to simple title.');
        return prompt.length > 28 ? prompt.slice(0, 28) + '\u2026' : prompt;
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "openai/gpt-oss-120b",
                messages: [
                    {
                        "role": "system",
                        "content": "You are a helpful assistant that summarizes a user prompt into a short thread title (maximum 3-4 words). Do not include any quotes or punctuation. Use normal capitalization like a phrase or sentence."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature: 1,
                max_completion_tokens: 8192,
                top_p: 1,
                reasoning_effort: "medium",
                stream: false,
                stop: null
            })
        });

        if (!response.ok) {
            throw new Error(`Groq API returned ${response.status}`);
        }

        const data = await response.json();
        const rawText = data.choices?.[0]?.message?.content;

        if (!rawText) {
            throw new Error('Groq API returned an empty or invalid response');
        }

        let title = rawText.trim();

        // Remove surrounding quotes if model included them
        title = title.replace(/^["']|["']$/g, '');

        return title || 'New thread';

    } catch (err) {
        console.error('Failed to generate title via Groq:', err);
        return prompt.length > 28 ? prompt.slice(0, 28) + '\u2026' : prompt;
    }
}
