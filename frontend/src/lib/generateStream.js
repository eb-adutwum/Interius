function getBackendBaseUrl() {
    const explicit =
        import.meta.env.VITE_BACKEND_URL ||
        import.meta.env.VITE_BACKEND_API_URL;

    return (explicit || 'http://localhost:8000').replace(/\/$/, '');
}

function parseSseEvent(block) {
    const lines = block.split(/\r?\n/);
    const dataLines = [];

    for (const line of lines) {
        if (!line || line.startsWith(':')) continue;
        if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
        }
    }

    if (!dataLines.length) return null;

    const dataText = dataLines.join('\n');
    try {
        return JSON.parse(dataText);
    } catch {
        return { status: 'raw', data: dataText };
    }
}

export async function streamThreadChatGeneration({
    threadId,
    prompt,
    recentMessages = [],
    attachmentSummaries = [],
    threadContextFiles = [],
    stopAfterArchitecture = false,
    resumeFromStage = null,
    approvedRequirementsArtifact = null,
    approvedArchitectureArtifact = null,
    signal,
    onEvent,
}) {
    const response = await fetch(`${getBackendBaseUrl()}/api/v1/generate/thread/${threadId}/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            prompt,
            recent_messages: recentMessages,
            attachment_summaries: attachmentSummaries,
            thread_context_files: threadContextFiles,
            stop_after_architecture: stopAfterArchitecture,
            resume_from_stage: resumeFromStage,
            approved_requirements_artifact: approvedRequirementsArtifact,
            approved_architecture_artifact: approvedArchitectureArtifact,
        }),
        signal,
    });

    if (!response.ok) {
        let detail = '';
        try {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const body = await response.json();
                detail = body?.detail || body?.message || '';
            } else {
                detail = (await response.text()).trim();
            }
        } catch {
            // ignore parse failures and fall back to status-only error
        }
        const message = `Chat generation stream returned ${response.status}${detail ? `: ${detail}` : ''}`;
        throw new Error(message);
    }

    if (!response.body) {
        throw new Error('Streaming response body unavailable');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
            const event = parseSseEvent(chunk);
            if (!event) continue;
            onEvent?.(event);
        }
    }

    if (buffer.trim()) {
        const event = parseSseEvent(buffer);
        if (event) onEvent?.(event);
    }
}
