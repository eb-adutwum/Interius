import hashlib
import logging
from typing import Any

import chromadb
from chromadb.config import Settings
from chromadb.utils import embedding_functions

from app.core.config import settings

logger = logging.getLogger(__name__)


def _metadata_filter(**conditions: str) -> dict[str, Any]:
    items = [{key: value} for key, value in conditions.items() if value is not None]
    if not items:
        return {}
    if len(items) == 1:
        return items[0]
    return {"$and": items}


def chunk_code_text(
    text: str,
    *,
    max_chars: int = 1600,
    overlap_lines: int = 4,
) -> list[dict[str, int | str]]:
    normalized = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")

    if not any(line.strip() for line in lines):
        return []

    chunks: list[dict[str, int | str]] = []
    start = 0
    while start < len(lines):
        chunk_lines: list[str] = []
        current_len = 0
        end = start

        while end < len(lines):
            line = lines[end]
            addition = len(line) + (1 if chunk_lines else 0)
            if chunk_lines and current_len + addition > max_chars:
                break
            chunk_lines.append(line)
            current_len += addition
            end += 1

        if end == start:
            chunk_lines = [lines[start][:max_chars]]
            end = start + 1

        content = "\n".join(chunk_lines).strip("\n")
        if content.strip():
            chunks.append(
                {
                    "content": content,
                    "start_line": start + 1,
                    "end_line": end,
                }
            )

        if end >= len(lines):
            break

        next_start = max(start + 1, end - max(0, overlap_lines))
        start = next_start if next_start > start else end

    return chunks


def format_thread_generated_file_context(snippets: list[dict[str, Any]]) -> str:
    if not snippets:
        return ""

    sections = ["Relevant Context from Generated Files in This Thread:"]
    for index, snippet in enumerate(snippets, start=1):
        filename = snippet.get("filename") or "unknown"
        start_line = snippet.get("start_line")
        end_line = snippet.get("end_line")
        if start_line and end_line:
            ref = f"{filename}:{start_line}-{end_line}"
        elif start_line:
            ref = f"{filename}:{start_line}"
        else:
            ref = filename
        sections.extend(
            [
                "",
                f"[Snippet {index} | {ref}]",
                str(snippet.get("content") or ""),
            ]
        )
    return "\n".join(sections).strip()


class RAGManager:
    """Manages document embedding and vector search using ChromaDB and Gemini."""

    def __init__(self, persist_directory: str = "./chroma_db"):
        self.persist_directory = persist_directory

        # Initialize Gemini embedding function for ChromaDB.
        # Note: We can use the default embedding if no API key is set, but usually we'll have one.
        if settings.GEMINI_API_KEY:
            # We must use gemini's standard embedding function
            from chromadb.utils.embedding_functions import (
                GoogleGenerativeAiEmbeddingFunction,
            )
            self.embedding_function = GoogleGenerativeAiEmbeddingFunction(
                api_key=settings.GEMINI_API_KEY,
                model_name="models/text-embedding-004"
            )
        else:
            self.embedding_function = embedding_functions.DefaultEmbeddingFunction()

        self.client = chromadb.PersistentClient(
            path=self.persist_directory,
            settings=Settings(allow_reset=True)
        )

        self.collection_name = "project_documents"
        self.collection = self.client.get_or_create_collection(
            name=self.collection_name,
            embedding_function=self.embedding_function
        )

    def add_document_chunks(self, project_id: str, document_id: str, filename: str, chunks: list[str]):
        """Embed and store document chunks in ChromaDB."""
        if not chunks:
            return

        ids = [f"{document_id}_{i}" for i in range(len(chunks))]
        metadatas = [{"project_id": str(project_id), "document_id": str(document_id), "filename": filename} for _ in chunks]

        try:
            self.collection.add(
                documents=chunks,
                metadatas=metadatas,
                ids=ids
            )
            logger.info(f"Added {len(chunks)} chunks for document {document_id}")
        except Exception as e:
            logger.error(f"Error adding chunks to ChromaDB: {e}")
            raise

    def query_context(self, project_id: str, query: str, n_results: int = 5) -> str:
        """Search ChromaDB for relevant context given a query and project_id."""
        if not query:
            return ""

        try:
            results = self.collection.query(
                query_texts=[query],
                n_results=n_results,
                where=_metadata_filter(project_id=str(project_id))
            )

            if not results["documents"] or not results["documents"][0]:
                return ""

            # Combine retrieved chunks into a context string
            context_chunks = results["documents"][0]
            context = "\n\n---\n\n".join(context_chunks)
            return f"Relevant Context from Project Documents:\n\n{context}"

        except Exception as e:
            logger.error(f"Error querying ChromaDB: {e}")
            return ""

    def replace_thread_generated_files(self, thread_id: str, files: list[dict[str, Any]]):
        """Replace the generated-file index for a thread with the latest code artifact set."""
        self.delete_thread_generated_files(thread_id)

        documents: list[str] = []
        metadatas: list[dict[str, Any]] = []
        ids: list[str] = []

        for file_index, file in enumerate(files or []):
            path = str(file.get("path") or file.get("filename") or "").strip()
            content = str(file.get("content") or "").strip()
            if not path or not content:
                continue

            file_hash = hashlib.md5(path.encode("utf-8")).hexdigest()[:12]
            chunks = chunk_code_text(content)
            for chunk_index, chunk in enumerate(chunks):
                documents.append(str(chunk["content"]))
                metadatas.append(
                    {
                        "thread_id": str(thread_id),
                        "source_type": "generated_file",
                        "filename": path,
                        "file_index": file_index,
                        "chunk_index": chunk_index,
                        "start_line": int(chunk["start_line"]),
                        "end_line": int(chunk["end_line"]),
                    }
                )
                ids.append(f"thread_{thread_id}_{file_hash}_{chunk_index}")

        if not documents:
            return

        try:
            self.collection.add(
                documents=documents,
                metadatas=metadatas,
                ids=ids,
            )
            logger.info(
                "Indexed %s generated-file chunk(s) across %s file(s) for thread %s",
                len(documents),
                len(files or []),
                thread_id,
            )
        except Exception as e:
            logger.error(f"Error indexing generated files for thread {thread_id}: {e}")
            raise

    def query_thread_generated_files(
        self,
        thread_id: str,
        query: str,
        n_results: int = 5,
    ) -> list[dict[str, Any]]:
        """Search for generated-file snippets scoped to a single chat thread."""
        if not query:
            return []

        try:
            results = self.collection.query(
                query_texts=[query],
                n_results=n_results,
                where=_metadata_filter(
                    thread_id=str(thread_id),
                    source_type="generated_file",
                ),
            )
        except Exception as e:
            logger.error(f"Error querying generated files for thread {thread_id}: {e}")
            return []

        documents = (results.get("documents") or [[]])[0] if isinstance(results.get("documents"), list) else []
        metadatas = (results.get("metadatas") or [[]])[0] if isinstance(results.get("metadatas"), list) else []
        snippets: list[dict[str, Any]] = []
        for idx, document in enumerate(documents):
            metadata = metadatas[idx] if idx < len(metadatas) and isinstance(metadatas[idx], dict) else {}
            snippets.append(
                {
                    "filename": metadata.get("filename") or "unknown",
                    "content": document,
                    "chunk_index": metadata.get("chunk_index"),
                    "start_line": metadata.get("start_line"),
                    "end_line": metadata.get("end_line"),
                }
            )
        return snippets

    def delete_project_documents(self, project_id: str):
        """Delete all documents associated with a project."""
        try:
            self.collection.delete(
                where=_metadata_filter(project_id=str(project_id))
            )
        except Exception as e:
            logger.error(f"Error deleting documents for project {project_id}: {e}")

    def delete_document(self, document_id: str):
        """Delete specific document chunks."""
        try:
            self.collection.delete(
                where=_metadata_filter(document_id=str(document_id))
            )
        except Exception as e:
            logger.error(f"Error deleting document {document_id}: {e}")

    def delete_thread_generated_files(self, thread_id: str):
        """Delete generated-file chunks for a specific chat thread."""
        try:
            self.collection.delete(
                where=_metadata_filter(
                    thread_id=str(thread_id),
                    source_type="generated_file",
                )
            )
        except Exception as e:
            logger.error(f"Error deleting generated files for thread {thread_id}: {e}")

_rag_manager_instance = None

def get_rag_manager() -> RAGManager:
    """Lazily initializes the RAG manager to prevent module load freezing."""
    global _rag_manager_instance
    if _rag_manager_instance is None:
        _rag_manager_instance = RAGManager()
    return _rag_manager_instance
