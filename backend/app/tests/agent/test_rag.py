import os
import shutil
import tempfile
import pytest
from unittest.mock import patch, MagicMock

from app.agent.rag import RAGManager


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
    from app.api.routes.documents import chunk_text
    text = "A" * 3000
    chunks = chunk_text(text, chunk_size=2000, overlap=100)
    assert len(chunks) == 2
    assert len(chunks[0]) == 2000
    assert len(chunks[1]) == 1100
