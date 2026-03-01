function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function parseSseEventBlock(block) {
  const dataLines = [];
  for (const line of String(block || "").split(/\r?\n/)) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (!dataLines.length) {
    return null;
  }
  return JSON.parse(dataLines.join("\n"));
}

export async function streamBuild({
  backendUrl,
  token,
  threadId,
  prompt,
  recentMessages,
  attachmentSummaries,
  threadContextFiles,
  onEvent,
}) {
  const response = await fetch(
    `${trimTrailingSlash(backendUrl)}/api/v1/generate/thread/${encodeURIComponent(threadId)}/chat`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        prompt,
        recent_messages: recentMessages || [],
        attachment_summaries: attachmentSummaries || [],
        thread_context_files: threadContextFiles || [],
        runtime_mode: "local_cli",
        stop_after_architecture: false,
      }),
    },
  );

  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(
      `Backend stream request failed with ${response.status}: ${detail || response.statusText}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const event = parseSseEventBlock(block);
      if (event) {
        await onEvent?.(event);
      }
    }
  }

  if (buffer.trim()) {
    const event = parseSseEventBlock(buffer);
    if (event) {
      await onEvent?.(event);
    }
  }
}
