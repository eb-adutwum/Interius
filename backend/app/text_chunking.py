def chunk_text(text: str, chunk_size: int = 2000, overlap: int = 200) -> list[str]:
    """Split text into overlapping character chunks with simple natural break detection."""
    chunks: list[str] = []
    start = 0
    text_len = len(text)

    while start < text_len:
        end = min(start + chunk_size, text_len)

        if end < text_len:
            break_point = end
            for i in range(end, max(start, end - 100), -1):
                if text[i] in ["\n", ".", " "]:
                    break_point = i + 1
                    break
            end = break_point

        chunks.append(text[start:end])
        if end >= text_len:
            break
        start = max(end - overlap, start + 1)

    return chunks
