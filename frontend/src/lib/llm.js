export async function generateThreadTitle(prompt) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
        console.warn('No Gemini API key provided. Falling back to simple title.');
        return (prompt.length > 28 ? prompt.slice(0, 28) + '\u2026' : prompt).toLowerCase().replace(/\s+/g, '-');
    }

    try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                system_instruction: {
                    parts: [{ text: 'You are a helpful assistant that summarizes a user prompt into a short, hyphenated, lowercase thread title (maximum 3-4 words). Do not include any quotes or punctuation.' }]
                },
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 10,
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Gemini API returned ${response.status}`);
        }

        const data = await response.json();
        let title = data.candidates[0].content.parts[0].text.trim().toLowerCase().replace(/\s+/g, '-');

        // Remove trailing punctuation
        title = title.replace(/[^a-z0-9-]+/g, '');
        return title || 'new-thread';

    } catch (err) {
        console.error('Failed to generate title via Gemini:', err);
        return (prompt.length > 28 ? prompt.slice(0, 28) + '\u2026' : prompt).toLowerCase().replace(/\s+/g, '-');
    }
}
