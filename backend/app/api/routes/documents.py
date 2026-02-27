import io
import uuid
from typing import Any

import pypdf
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlmodel import Session, select

from app.api.deps import CurrentUser, get_db
from app.models import Document, DocumentCreate, DocumentPublic
from app.agent.rag import get_rag_manager
from app.text_chunking import chunk_text

router = APIRouter()

def extract_text_from_file(file: UploadFile, content: bytes) -> str:
    """Extracts text from a given file based on content type."""
    if file.content_type == "application/pdf":
        try:
            pdf_reader = pypdf.PdfReader(io.BytesIO(content))
            text = ""
            for page in pdf_reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
            return text
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse PDF: {str(e)}")
            
    elif file.content_type == "text/plain" or file.content_type == "text/markdown":
        return content.decode("utf-8")
        
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

@router.post("/", response_model=DocumentPublic)
async def upload_document(
    *,
    session: Session = Depends(get_db),
    current_user: CurrentUser,
    project_id: str = Form(...),
    file: UploadFile = File(...)
) -> Any:
    """
    Upload a document, parse its text, chunk it, and store it in ChromaDB for RAG.
    """
    # Note: In a real app we'd verify the project belongs to the user here.
    # We will assume project_id is valid for now.
    
    content = await file.read()
    
    # Extract text based on file type
    text = extract_text_from_file(file, content)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Could not extract any text from the document.")
        
    # Chunk the text
    chunks = chunk_text(text)
    
    # Save document record in DB
    document = Document(
        filename=file.filename or "unknown",
        content_type=file.content_type or "application/octet-stream",
        project_id=project_id,
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    
    # Embed and store chunks in ChromaDB
    get_rag_manager().add_document_chunks(
        project_id=project_id,
        document_id=str(document.id),
        filename=document.filename,
        chunks=chunks
    )
    
    return document

@router.get("/{project_id}", response_model=list[DocumentPublic])
def read_project_documents(
    project_id: str,
    session: Session = Depends(get_db),
    current_user: CurrentUser = None
) -> Any:
    """
    Retrieve documents for a project.
    """
    statement = select(Document).where(Document.project_id == project_id)
    documents = session.exec(statement).all()
    return documents

@router.delete("/{id}")
def delete_document(
    id: uuid.UUID,
    session: Session = Depends(get_db),
    current_user: CurrentUser = None
) -> Any:
    """
    Delete a document from DB and ChromaDB.
    """
    document = session.get(Document, id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
        
    # Delete from vector db
    get_rag_manager().delete_document(str(document.id))
    
    # Delete from pg
    session.delete(document)
    session.commit()
    return {"message": "Document deleted successfully"}
