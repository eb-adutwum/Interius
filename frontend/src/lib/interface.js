const INTERFACE_CTX_PREFIX = 'interius_interface_ctx:';
const INTERFACE_CTX_TTL_MS = 30 * 60 * 1000;
const INTERFACE_CTX_MAX_MESSAGES = 10;

function getBackendBaseUrl() {
    const explicit =
        import.meta.env.VITE_BACKEND_URL ||
        import.meta.env.VITE_BACKEND_API_URL;

    return (explicit || 'http://localhost:8000').replace(/\/$/, '');
}

function toInterfaceContextMessage(message) {
    const role = message?.role || message?.type;
    const content = (message?.content || message?.text || '').trim();
    if (!content) return null;
    if (!['user', 'assistant', 'agent'].includes(role)) return null;
    return { role, content };
}

function trimRecentMessages(messages) {
    return (messages || [])
        .map(toInterfaceContextMessage)
        .filter(Boolean)
        .slice(-INTERFACE_CTX_MAX_MESSAGES);
}

function storageKey(threadId) {
    return `${INTERFACE_CTX_PREFIX}${threadId}`;
}

export function getInterfaceThreadContext(threadId) {
    if (!threadId || typeof window === 'undefined') return [];

    try {
        const raw = window.sessionStorage.getItem(storageKey(threadId));
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        const updatedAt = Number(parsed?.updatedAt || 0);
        if (!updatedAt || (Date.now() - updatedAt) > INTERFACE_CTX_TTL_MS) {
            window.sessionStorage.removeItem(storageKey(threadId));
            return [];
        }

        return trimRecentMessages(parsed?.recentMessages || []);
    } catch {
        return [];
    }
}

function writeInterfaceThreadContext(threadId, messages) {
    if (!threadId || typeof window === 'undefined') return;
    const recentMessages = trimRecentMessages(messages);
    window.sessionStorage.setItem(
        storageKey(threadId),
        JSON.stringify({ updatedAt: Date.now(), recentMessages })
    );
}

export function setInterfaceThreadContextFromMessages(threadId, messages) {
    writeInterfaceThreadContext(threadId, messages);
}

export function appendInterfaceThreadContext(threadId, message) {
    const current = getInterfaceThreadContext(threadId);
    writeInterfaceThreadContext(threadId, [...current, message]);
}

export function clearInterfaceThreadContext(threadId) {
    if (!threadId || typeof window === 'undefined') return;
    window.sessionStorage.removeItem(storageKey(threadId));
}

export function copyInterfaceThreadContext(sourceThreadId, targetThreadId) {
    if (!sourceThreadId || !targetThreadId || sourceThreadId === targetThreadId) return;
    const messages = getInterfaceThreadContext(sourceThreadId);
    if (!messages.length) return;
    writeInterfaceThreadContext(targetThreadId, messages);
}

export function clearAllInterfaceThreadContexts() {
    if (typeof window === 'undefined') return;
    const keys = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
        const key = window.sessionStorage.key(i);
        if (key?.startsWith(INTERFACE_CTX_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
}

export async function routeChatIntent(prompt, options = {}) {
    const recentMessages = trimRecentMessages(options.recentMessages || []);
    const attachmentSummaries = (options.attachmentSummaries || []).slice(-8);
    const response = await fetch(`${getBackendBaseUrl()}/api/v1/generate/interface`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            prompt,
            recent_messages: recentMessages,
            attachment_summaries: attachmentSummaries,
        }),
    });

    if (!response.ok) {
        throw new Error(`Interface route returned ${response.status}`);
    }

    return response.json();
}
