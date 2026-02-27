import shutil
import tempfile
from unittest.mock import patch, MagicMock
import pytest

from app.agent.rag import RAGManager, chunk_code_text, format_thread_generated_file_context


@pytest.fixture
def temp_chroma():
    # Setup temporary directory for ChromDB
    temp_dir = tempfile.mkdtemp()
    
    # Mock PersistentClient entirely to avoid ChromaDB startup / telemetry freezes
    with patch("app.agent.rag.chromadb.PersistentClient") as mock_chroma_client:
        mock_collection = MagicMock()
        mock_chroma_client.return_value.get_or_create_collection.return_value = mock_collection
        
        # Mock settings so we don't try to use the real Gemini embedding unless we have key
        with patch("app.agent.rag.settings.GEMINI_API_KEY", ""):
            # Mock default embedding to avoid ONNX download
            with patch("app.agent.rag.embedding_functions.DefaultEmbeddingFunction"):
                manager = RAGManager(persist_directory=temp_dir)
                yield manager, mock_collection
        
    # Teardown
    shutil.rmtree(temp_dir)


def test_rag_manager_add_and_query(temp_chroma):
    manager, mock_collection = temp_chroma
    project_id = "test_project_123"
    document_id = "doc_456"
    chunks = [
        "The project needs to be built with FastAPI.",
        "The database should be PostgreSQL.",
        "Make sure to add user authentication."
    ]
    
    # Add chunks
    manager.add_document_chunks(project_id, document_id, "notes.txt", chunks)
    mock_collection.add.assert_called_once()
    
    # Setup mock query response
    mock_collection.query.return_value = {
        "documents": [["The database should be PostgreSQL."]]
    }
    
    # Query context
    context = manager.query_context(project_id, "What database should I use?", n_results=1)
    
    # Ensure context contains the relevant chunk
    assert "PostgreSQL" in context
    
    # Setup empty response
    mock_collection.query.return_value = {"documents": []}
    
    # Query empty
    empty_context = manager.query_context("different_project", "What database should I use?", n_results=1)
    assert empty_context == ""

def test_chunking_logic():
    from app.text_chunking import chunk_text
    text = "A" * 3000
    chunks = chunk_text(text, chunk_size=2000, overlap=100)
    assert len(chunks) == 2
    assert len(chunks[0]) == 2000
    assert len(chunks[1]) == 1100


def test_replace_and_query_thread_generated_files(temp_chroma):
    manager, mock_collection = temp_chroma
    thread_id = "thread_abc123"
    files = [
        {
            "path": "app/api/routes/users.py",
            "content": "\n".join(
                [
                    "from fastapi import APIRouter",
                    "",
                    "router = APIRouter()",
                    "",
                    "@router.get('/users')",
                    "def list_users():",
                    "    return []",
                ]
            ),
        },
        {
            "path": "app/core/security.py",
            "content": "\n".join(
                [
                    "def verify_password(password: str, hashed: str) -> bool:",
                    "    return password == hashed",
                ]
            ),
        },
    ]

    manager.replace_thread_generated_files(thread_id, files)

    mock_collection.delete.assert_called_with(
        where={"$and": [{"thread_id": thread_id}, {"source_type": "generated_file"}]}
    )
    mock_collection.add.assert_called_once()
    add_kwargs = mock_collection.add.call_args.kwargs
    assert add_kwargs["documents"]
    assert all(meta["thread_id"] == thread_id for meta in add_kwargs["metadatas"])
    assert all(meta["source_type"] == "generated_file" for meta in add_kwargs["metadatas"])

    mock_collection.query.return_value = {
        "documents": [[files[0]["content"]]],
        "metadatas": [[
            {
                "filename": "app/api/routes/users.py",
                "chunk_index": 0,
                "start_line": 1,
                "end_line": 7,
            }
        ]],
    }

    snippets = manager.query_thread_generated_files(thread_id, "Where is the users route?", n_results=2)
    assert snippets == [
        {
            "filename": "app/api/routes/users.py",
            "content": files[0]["content"],
            "chunk_index": 0,
            "start_line": 1,
            "end_line": 7,
        }
    ]
    mock_collection.query.assert_called_with(
        query_texts=["Where is the users route?"],
        n_results=2,
        where={"$and": [{"thread_id": thread_id}, {"source_type": "generated_file"}]},
    )

    formatted = format_thread_generated_file_context(snippets)
    assert "users.py:1-7" in formatted
    assert "Relevant Context from Generated Files in This Thread" in formatted


def test_chunk_code_text_preserves_line_ranges():
    text = "\n".join([f"line {i}" for i in range(1, 60)])
    chunks = chunk_code_text(text, max_chars=70, overlap_lines=2)

    assert len(chunks) > 1
    assert chunks[0]["start_line"] == 1
    assert chunks[0]["end_line"] >= chunks[0]["start_line"]
    assert chunks[1]["start_line"] <= chunks[0]["end_line"]
