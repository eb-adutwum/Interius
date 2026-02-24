function getBackendBaseUrl() {
    const explicit =
        import.meta.env.VITE_BACKEND_URL ||
        import.meta.env.VITE_BACKEND_API_URL;

    return (explicit || 'http://localhost:8000').replace(/\/$/, '');
}

export async function routeChatIntent(prompt) {
    const response = await fetch(`${getBackendBaseUrl()}/api/v1/generate/interface`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
        throw new Error(`Interface route returned ${response.status}`);
    }

    return response.json();
}
