import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

const FILE_CTX_PREFIX = 'interius_thread_file_ctx:';
const FILE_CTX_TTL_MS = 30 * 60 * 1000;
const FILE_CTX_MAX_ENTRIES = 12;
const FILE_CTX_MAX_TEXT_CHARS = 30000;
const FILE_CTX_MAX_EXCERPT_CHARS = 320;
const PDF_PARSE_MAX_PAGES = 8;

let pdfJsModulePromise = null;

function keyForThread(threadId) {
    return `${FILE_CTX_PREFIX}${threadId}`;
}

function isBrowser() {
    return typeof window !== 'undefined' && !!window.sessionStorage;
}

function nowIso() {
    return new Date().toISOString();
}

function parseStored(threadId) {
    if (!isBrowser() || !threadId) return null;

    try {
        const raw = window.sessionStorage.getItem(keyForThread(threadId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const updatedAt = Number(parsed?.updatedAt || 0);
        if (!updatedAt || Date.now() - updatedAt > FILE_CTX_TTL_MS) {
            window.sessionStorage.removeItem(keyForThread(threadId));
            return null;
        }
        return {
            updatedAt,
            files: Array.isArray(parsed?.files) ? parsed.files : [],
        };
    } catch {
        return null;
    }
}

function writeStored(threadId, files) {
    if (!isBrowser() || !threadId) return;
    window.sessionStorage.setItem(
        keyForThread(threadId),
        JSON.stringify({
            updatedAt: Date.now(),
            files: files.slice(-FILE_CTX_MAX_ENTRIES),
        })
    );
}

function extensionOf(name) {
    const dot = (name || '').lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function looksTextLike(file) {
    const type = (file?.type || '').toLowerCase();
    if (type.startsWith('text/')) return true;
    return [
        'txt', 'md', 'markdown', 'json', 'csv', 'yaml', 'yml', 'ini', 'env',
        'py', 'js', 'ts', 'tsx', 'jsx', 'sql', 'xml', 'html', 'css'
    ].includes(extensionOf(file?.name || ''));
}

function looksPdf(file) {
    const type = (file?.type || '').toLowerCase();
    return type === 'application/pdf' || extensionOf(file?.name || '') === 'pdf';
}

async function getPdfJsModule() {
    if (!pdfJsModulePromise) {
        pdfJsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
            if (mod?.GlobalWorkerOptions && !mod.GlobalWorkerOptions.workerSrc) {
                mod.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
            }
            return mod;
        });
    }
    return pdfJsModulePromise;
}

async function extractPdfText(file) {
    const { getDocument } = await getPdfJsModule();
    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = getDocument({
        data,
        disableWorker: true,
        useWorkerFetch: false,
        isEvalSupported: false,
    });

    const pdf = await loadingTask.promise;
    const pageCount = Math.min(pdf.numPages || 0, PDF_PARSE_MAX_PAGES);
    const chunks = [];

    for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const pageText = content.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (pageText) {
            chunks.push(pageText);
        }

        const joinedLength = chunks.join('\n').length;
        if (joinedLength >= FILE_CTX_MAX_TEXT_CHARS) break;
    }

    const text = chunks.join('\n').slice(0, FILE_CTX_MAX_TEXT_CHARS).trim();
    return text;
}

function sanitizeExcerpt(text) {
    return (text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, FILE_CTX_MAX_EXCERPT_CHARS);
}

async function buildEntryFromFile(file) {
    const base = {
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        filename: file.name,
        mime_type: file.type || null,
        size_bytes: file.size ?? null,
        last_modified: file.lastModified ?? null,
        added_at: nowIso(),
        has_text_content: false,
        text_excerpt: null,
        text_content: null,
    };

    if (!looksTextLike(file) && !looksPdf(file)) {
        return base;
    }

    try {
        const raw = looksPdf(file) ? await extractPdfText(file) : await file.text();
        if (!raw?.trim()) {
            return base;
        }
        const textContent = raw.slice(0, FILE_CTX_MAX_TEXT_CHARS);
        return {
            ...base,
            has_text_content: true,
            text_excerpt: sanitizeExcerpt(textContent),
            text_content: textContent,
        };
    } catch (error) {
        if (looksPdf(file)) {
            console.warn(`PDF text extraction failed for "${file.name}"`, error);
        }
        return base;
    }
}

function dedupeAndTrim(files) {
    const seen = new Map();
    const out = [];

    for (let i = files.length - 1; i >= 0; i -= 1) {
        const f = files[i];
        const sig = [f.filename, f.size_bytes, f.mime_type].join('|');
        const existingIndex = seen.get(sig);
        if (existingIndex != null) {
            const existing = out[existingIndex];
            // Prefer the version that has text content (session-local parsed copy).
            if (!existing?.has_text_content && f?.has_text_content) {
                out[existingIndex] = f;
            }
            continue;
        }
        seen.set(sig, out.length);
        out.push(f);
        if (out.length >= FILE_CTX_MAX_ENTRIES) break;
    }

    return out.reverse();
}

export function getThreadFileContext(threadId) {
    return parseStored(threadId)?.files || [];
}

export function getThreadFileContextSummaries(threadId) {
    return getThreadFileContext(threadId).map((f) => ({
        filename: f.filename,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
        text_excerpt: f.text_excerpt,
        has_text_content: Boolean(f.has_text_content),
    }));
}

export function getThreadBuildContextFiles(threadId) {
    return getThreadFileContext(threadId).map((f) => ({
        filename: f.filename,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
        has_text_content: Boolean(f.has_text_content),
        text_content: f.text_content || null,
    }));
}

export async function ingestThreadFiles(threadId, files) {
    if (!threadId || !files?.length) return [];

    const existing = getThreadFileContext(threadId);
    const built = [];
    for (const file of files) {
        built.push(await buildEntryFromFile(file));
    }
    const merged = dedupeAndTrim([...existing, ...built]);
    writeStored(threadId, merged);
    return built;
}

export function mergeThreadFileMetadata(threadId, attachmentRows) {
    if (!threadId || !Array.isArray(attachmentRows) || attachmentRows.length === 0) return;

    const existing = getThreadFileContext(threadId);
    const metadataEntries = attachmentRows.map((row) => ({
        id: row.id || `${row.message_id || 'msg'}-${row.original_name || 'file'}`,
        filename: row.original_name,
        mime_type: row.mime_type || null,
        size_bytes: row.size_bytes ?? null,
        last_modified: null,
        added_at: row.created_at || nowIso(),
        has_text_content: false,
        text_excerpt: null,
        text_content: null,
    }));

    writeStored(threadId, dedupeAndTrim([...existing, ...metadataEntries]));
}

export function clearThreadFileContext(threadId) {
    if (!isBrowser() || !threadId) return;
    window.sessionStorage.removeItem(keyForThread(threadId));
}

export function copyThreadFileContext(sourceThreadId, targetThreadId) {
    if (!sourceThreadId || !targetThreadId || sourceThreadId === targetThreadId) return;
    const files = getThreadFileContext(sourceThreadId);
    if (!files.length) return;
    writeStored(targetThreadId, files);
}

export function clearAllThreadFileContexts() {
    if (!isBrowser()) return;
    const keys = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
        const key = window.sessionStorage.key(i);
        if (key?.startsWith(FILE_CTX_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
}
