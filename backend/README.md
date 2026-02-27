# Interius Backend

The backend for Interius is built with **FastAPI** and **SQLModel** (via SQLAlchemy). It uses an asynchronous Server-Sent Events (SSE) stream to drive the AI agentic pipeline, emitting live status events to the frontend while simultaneously persisting data artifacts to PostgreSQL.

## Core Structure

* `app/agent/`: Contains the pipeline logic.
  * `orchestrator.py`: The `run_pipeline_generator` handles the feed-forward pipeline and the `ReviewerAgent` retry loop.
  * `artifacts.py`: Defines the structured Pydantic outputs passed between agents.
  * `rag.py`: Uses an embedded ChromaDB client to perform Retrieval-Augmented Generation.
  * `*^*_agent.py`: Individual agents (Requirements, Architecture, Implementer, Reviewer) inheriting from `BaseAgent`.
  * `client.py`: Provides a unified `AsyncOpenAI` client, supporting seamless switching between providers like OpenRouter, Groq, Ollama, and OpenAI.
* `app/api/`: Contains standard REST endpoints handling user authentication, projects, pipeline jobs, and sandbox deployment via standard dependency injection.
* `app/models.py`: Defines the database schemas mapping to PostgreSQL.

## Running Locally

Interius uses `uv` for python dependency management. Ensure PostgreSQL is running (e.g., via `docker compose up db -d`).

1. Sync dependencies:
   ```bash
   uv sync
   ```

   If you are not using `uv`, use the curated fallback requirements file instead of a frozen environment export:
   ```bash
   python -m pip install -r requirements.txt
   ```

2. Generate the local DB schemas (if not already managed by the prestart script):
   ```bash
   uv run alembic upgrade head
   ```

3. Start the FastAPI development server:
   ```bash
   uv run fastapi run app/main.py --reload
   ```
