# Interius CLI

`@interius/cli` streams the existing backend generation pipeline into the current working directory, writes the repaired files locally, installs Python dependencies into `.venv`, and starts the generated FastAPI app with uvicorn.

## Commands

```bash
interius login http://localhost:8000
interius "Build a todo API with CRUD endpoints"
interius status
interius logs
interius stop
```

## Notes

- The CLI uses the backend thread streaming endpoint.
- Generated files are written into the current folder.
- Existing files are backed up into `.interius/backups/...` before they are overwritten.
- The local API is started without Docker and the CLI prints the Swagger UI URL after startup.
