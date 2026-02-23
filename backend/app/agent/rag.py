import logging

import chromadb
from chromadb.config import Settings
from chromadb.utils import embedding_functions

from app.core.config import settings

logger = logging.getLogger(__name__)

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
                where={"project_id": str(project_id)}
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

    def delete_project_documents(self, project_id: str):
        """Delete all documents associated with a project."""
        try:
            self.collection.delete(
                where={"project_id": str(project_id)}
            )
        except Exception as e:
            logger.error(f"Error deleting documents for project {project_id}: {e}")

    def delete_document(self, document_id: str):
        """Delete specific document chunks."""
        try:
            self.collection.delete(
                where={"document_id": str(document_id)}
            )
        except Exception as e:
            logger.error(f"Error deleting document {document_id}: {e}")

_rag_manager_instance = None

def get_rag_manager() -> RAGManager:
    """Lazily initializes the RAG manager to prevent module load freezing."""
    global _rag_manager_instance
    if _rag_manager_instance is None:
        _rag_manager_instance = RAGManager()
    return _rag_manager_instance
