function getBackendBaseUrl() {
    const explicit =
        import.meta.env.VITE_BACKEND_URL ||
        import.meta.env.VITE_BACKEND_API_URL;

    return (explicit || 'http://localhost:8000').replace(/\/$/, '');
}

export async function testGeneratedArtifacts({ generatedFileMap = {}, dependencies = [] }) {
    const response = await fetch(`${getBackendBaseUrl()}/api/v1/generate/test-artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            generated_file_map: generatedFileMap,
            dependencies,
        }),
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const detail = payload?.detail || payload?.message || `Request failed (${response.status})`;
        throw new Error(detail);
    }

    return payload;
}
