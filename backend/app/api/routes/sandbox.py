"""
Sandbox deployment endpoints.

Each project gets its own ephemeral Docker container and host port so
thread-specific sandboxes do not overwrite each other.
"""
import ast
import logging
import json
import os
import re
import shutil
import socket
import subprocess
import time
import uuid
import urllib.request
from io import StringIO
from collections.abc import Iterable
from pathlib import Path
from typing import Any
import tokenize
from urllib.parse import quote, urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.agent.artifact_store import load_code_bundle
from app.api.deps import CurrentUser, get_db
from app.api.routes.generate import _chat_thread_project_marker, _get_or_create_chat_bridge_user
from app.models import ArtifactRecord, GenerationRun, Project

logger = logging.getLogger(__name__)
router = APIRouter()

SANDBOX_HOST_ROOT = Path(
    os.getenv("SANDBOX_HOST_ROOT", str(Path(__file__).resolve().parents[4] / ".sandbox_data"))
)
SANDBOX_CONTAINER_ROOT = Path(os.getenv("SANDBOX_CONTAINER_ROOT", "/sandbox"))
SANDBOX_DOCKER_IMAGE = os.getenv("SANDBOX_DOCKER_IMAGE", "python:3.12-slim")
SANDBOX_CONTAINER_WORKDIR = os.getenv("SANDBOX_CONTAINER_WORKDIR", "/workspace")
SANDBOX_PUBLIC_HOST = os.getenv("SANDBOX_PUBLIC_HOST", "localhost")
SANDBOX_PORT_RANGE_START = int(os.getenv("SANDBOX_PORT_RANGE_START", "9100"))
SANDBOX_PORT_RANGE_END = int(os.getenv("SANDBOX_PORT_RANGE_END", "9199"))
SANDBOX_TESTER_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
SANDBOX_SKIP_ROUTE_PARAM_NAMES = {
    "db",
    "session",
    "request",
    "response",
    "current_user",
    "user",
    "background_tasks",
}


class SandboxStatus(BaseModel):
    status: str
    message: str
    swagger_url: str | None = None
    project_id: str | None = None
    sandbox_mode: str | None = None
    error: str | None = None
    logs: str | None = None


class SandboxProxyRequest(BaseModel):
    method: str
    path: str
    path_params: dict[str, Any] = Field(default_factory=dict)
    query_params: dict[str, Any] = Field(default_factory=dict)
    json_body: Any = None


def _ensure_sandbox_root() -> Path:
    SANDBOX_HOST_ROOT.mkdir(parents=True, exist_ok=True)
    return SANDBOX_HOST_ROOT


def _sandbox_host_dir(project_id: uuid.UUID) -> Path:
    return _ensure_sandbox_root() / str(project_id)


def _sandbox_container_dir(project_id: uuid.UUID) -> Path:
    return SANDBOX_CONTAINER_ROOT / str(project_id)


def _sandbox_env_host_path(project_id: uuid.UUID) -> Path:
    return _sandbox_host_dir(project_id) / ".env"


def _sandbox_runtime_host_path(project_id: uuid.UUID) -> Path:
    return _sandbox_host_dir(project_id) / ".sandbox-runtime.json"


def _sandbox_bootstrap_log_host_path(project_id: uuid.UUID) -> Path:
    return _sandbox_host_dir(project_id) / "sandbox.log"


def _sandbox_container_name(project_id: uuid.UUID) -> str:
    return f"prosit2-sandbox-{project_id.hex[:12]}-{uuid.uuid4().hex[:6]}"


def _read_text_if_present(path: Path, *, max_chars: int = 4000) -> str:
    if not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""
    text = text.strip()
    if len(text) <= max_chars:
        return text
    return text[-max_chars:]


def _read_runtime_info(project_id: uuid.UUID) -> dict[str, Any] | None:
    path = _sandbox_runtime_host_path(project_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _write_runtime_info(project_id: uuid.UUID, data: dict[str, Any]) -> None:
    _sandbox_runtime_host_path(project_id).write_text(
        json.dumps(data, indent=2, sort_keys=True),
        encoding="utf-8",
        newline="\n",
    )


def _delete_runtime_info(project_id: uuid.UUID) -> None:
    path = _sandbox_runtime_host_path(project_id)
    if path.exists():
        path.unlink()


def _read_all_runtime_infos() -> list[dict[str, Any]]:
    infos: list[dict[str, Any]] = []
    for runtime_path in _ensure_sandbox_root().glob("*/.sandbox-runtime.json"):
        try:
            data = json.loads(runtime_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(data, dict):
            infos.append(data)
    return infos


def _build_project_base_url(port: int) -> str:
    return f"http://{SANDBOX_PUBLIC_HOST}:{port}"


def _build_project_docs_url(port: int) -> str:
    return f"{_build_project_base_url(port).rstrip('/')}/docs"


def _build_project_openapi_url(port: int) -> str:
    return f"{_build_project_base_url(port).rstrip('/')}/openapi.json"


def _docker_cmd(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["docker", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if check and result.returncode != 0:
        stderr = (result.stderr or result.stdout or "Docker command failed.").strip()
        raise HTTPException(status_code=500, detail=stderr)
    return result


def _sandbox_logs(project_id: uuid.UUID, *, max_chars: int = 4000) -> str | None:
    info = _read_runtime_info(project_id)
    container_name = str((info or {}).get("container_name") or _sandbox_container_name(project_id))
    logs_text = ""
    try:
        result = _docker_cmd("logs", "--tail", "200", container_name, check=False)
        logs_text = (result.stdout or "") + ("\n" + result.stderr if result.stderr else "")
    except Exception:
        logs_text = ""

    file_logs = _read_text_if_present(_sandbox_bootstrap_log_host_path(project_id), max_chars=max_chars)
    parts = [part.strip() for part in [logs_text, file_logs] if part and part.strip()]
    if not parts:
        return None
    joined = "\n\n".join(parts)
    return joined if len(joined) <= max_chars else joined[-max_chars:]


def _logs_look_like_failure(text: str | None) -> bool:
    if not text:
        return False
    failure_markers = (
        "traceback",
        "syntaxerror",
        "modulenotfounderror",
        "importerror",
        "exception:",
        "error:",
        "failed to",
        "no module named",
    )
    lowered = text.lower()
    return any(marker in lowered for marker in failure_markers)


def _openapi_looks_like_fallback(spec: Any) -> bool:
    if not isinstance(spec, dict):
        return True
    paths = spec.get("paths")
    if not isinstance(paths, dict):
        return True
    meaningful_paths = [
        str(path).strip()
        for path in paths.keys()
        if str(path).strip() and str(path).strip() not in {"/", "/health", "/ready"}
    ]
    return len(meaningful_paths) == 0


def _is_host_port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def _allocate_sandbox_port(project_id: uuid.UUID) -> int:
    existing = _read_runtime_info(project_id)
    existing_port = (existing or {}).get("port")
    if isinstance(existing_port, int) and _is_host_port_available(existing_port):
        return existing_port

    reserved_ports = {
        int(info["port"])
        for info in _read_all_runtime_infos()
        if isinstance(info.get("port"), int)
    }
    for port in range(SANDBOX_PORT_RANGE_START, SANDBOX_PORT_RANGE_END + 1):
        if port in reserved_ports:
            continue
        if _is_host_port_available(port):
            return port
    raise HTTPException(status_code=500, detail="No free sandbox ports are available.")


def _docker_container_state(container_name: str) -> tuple[bool, bool]:
    result = _docker_cmd(
        "inspect",
        "-f",
        "{{.State.Running}}",
        container_name,
        check=False,
    )
    if result.returncode != 0:
        return False, False
    return True, result.stdout.strip().lower() == "true"


def _sandbox_internal_base_url(project_id: uuid.UUID) -> str | None:
    info = _read_runtime_info(project_id)
    port = (info or {}).get("port")
    if not isinstance(port, int):
        return None
    return _build_project_base_url(port)


def _is_sandbox_live(project_id: uuid.UUID) -> bool:
    info = _read_runtime_info(project_id)
    port = (info or {}).get("port")
    if not isinstance(port, int):
        return False
    try:
        with urllib.request.urlopen(_build_project_docs_url(port), timeout=3) as response:
            return 200 <= getattr(response, "status", 200) < 400
    except Exception:
        return False


def _wait_for_sandbox(project_id: uuid.UUID, timeout_seconds: int = 30) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if _is_sandbox_live(project_id):
            return True
        time.sleep(1)
    return False


def _stop_project_sandbox(project_id: uuid.UUID) -> None:
    info = _read_runtime_info(project_id)
    container_name = str((info or {}).get("container_name") or _sandbox_container_name(project_id))
    _docker_cmd("rm", "-f", container_name, check=False)


def _first_running_runtime() -> tuple[uuid.UUID, dict[str, Any]] | None:
    for info in _read_all_runtime_infos():
        project_id_raw = info.get("project_id")
        container_name = str(info.get("container_name") or "")
        try:
            project_id = uuid.UUID(str(project_id_raw))
        except (TypeError, ValueError):
            continue
        _, is_running = _docker_container_state(container_name)
        if is_running:
            return project_id, info
    return None


def _validate_python_sources(files: list[dict[str, Any]]) -> None:
    for file_entry in files:
        path = str(file_entry.get("path") or "")
        if not path.lower().endswith(".py"):
            continue
        source = str(file_entry.get("content") or "")
        try:
            compile(source, path, "exec")
        except SyntaxError as exc:
            line_number = exc.lineno or 1
            detail = f"Generated sandbox app has a syntax error in {path}:{line_number}: {exc.msg}"
            if exc.text:
                detail = f"{detail}\n{exc.text.strip()}"
            raise HTTPException(status_code=400, detail=detail) from exc


def _build_sandbox_status(project_id: uuid.UUID | None = None) -> SandboxStatus:
    resolved_project_id = project_id
    resolved_info = _read_runtime_info(project_id) if project_id else None

    if resolved_project_id is None:
        runtime = _first_running_runtime()
        if runtime:
            resolved_project_id, resolved_info = runtime

    if resolved_project_id is None:
        return SandboxStatus(
            status="stopped",
            message="Sandbox has not been started yet.",
        )

    runtime_info = resolved_info or _read_runtime_info(resolved_project_id)
    port = (runtime_info or {}).get("port")
    sandbox_mode = str((runtime_info or {}).get("mode") or "normalized")
    swagger_url = _build_project_docs_url(port) if isinstance(port, int) else None
    logs = _sandbox_logs(resolved_project_id)
    container_name = str((runtime_info or {}).get("container_name") or _sandbox_container_name(resolved_project_id))
    exists, is_running = _docker_container_state(container_name)

    if is_running and _is_sandbox_live(resolved_project_id):
        return SandboxStatus(
            status="running",
            message="Sandbox API is live.",
            swagger_url=swagger_url,
            project_id=str(resolved_project_id),
            sandbox_mode=sandbox_mode,
            logs=logs,
        )

    if is_running:
        return SandboxStatus(
            status="deploying",
            message="Sandbox deployment is still in progress.",
            swagger_url=swagger_url,
            project_id=str(resolved_project_id),
            sandbox_mode=sandbox_mode,
            logs=logs,
        )

    if _logs_look_like_failure(logs):
        return SandboxStatus(
            status="error",
            message="Sandbox failed to start.",
            swagger_url=swagger_url,
            project_id=str(resolved_project_id),
            sandbox_mode=sandbox_mode,
            error="The generated app crashed during startup.",
            logs=logs,
        )

    if exists or runtime_info:
        return SandboxStatus(
            status="stopped",
            message="Sandbox is not currently running.",
            swagger_url=swagger_url,
            project_id=str(resolved_project_id),
            sandbox_mode=sandbox_mode,
            logs=logs,
        )

    return SandboxStatus(
        status="stopped",
        message="Sandbox has not been started yet.",
        project_id=str(resolved_project_id),
        sandbox_mode="normalized",
    )


def _get_latest_code(session: Session, project_id: uuid.UUID) -> dict | None:
    run, artifacts = _get_latest_run_artifacts(session, project_id)
    if not run:
        return None

    reviewer_artifact = None
    implementer_artifact = None
    for artifact in artifacts:
        if artifact.stage.startswith("reviewer_pass"):
            reviewer_artifact = artifact
        elif artifact.stage == "implementer":
            implementer_artifact = artifact

    if reviewer_artifact and reviewer_artifact.content.get("final_code"):
        return {
            "files": reviewer_artifact.content["final_code"],
            "dependencies": implementer_artifact.content.get("dependencies", []) if implementer_artifact else [],
        }

    if reviewer_artifact and reviewer_artifact.content.get("bundle_ref"):
        bundle = load_code_bundle(str(reviewer_artifact.content["bundle_ref"]))
        if bundle and bundle.get("files"):
            return {
                "files": bundle.get("files", []),
                "dependencies": bundle.get("dependencies")
                or reviewer_artifact.content.get("dependencies", [])
                or implementer_artifact.content.get("dependencies", [])
                or [],
            }

    if implementer_artifact:
        if implementer_artifact.content.get("bundle_ref"):
            bundle = load_code_bundle(str(implementer_artifact.content["bundle_ref"]))
            if bundle and bundle.get("files"):
                return {
                    "files": bundle.get("files", []),
                    "dependencies": bundle.get("dependencies")
                    or implementer_artifact.content.get("dependencies", [])
                    or [],
                }
        return implementer_artifact.content

    return None


def _get_latest_run_artifacts(session: Session, project_id: uuid.UUID) -> tuple[GenerationRun | None, list[ArtifactRecord]]:
    run = (
        session.query(GenerationRun)
        .filter(GenerationRun.project_id == project_id)
        .order_by(GenerationRun.created_at.desc())
        .first()
    )
    if not run:
        return None, []
    artifacts = session.query(ArtifactRecord).filter(ArtifactRecord.run_id == run.id).all()
    return run, artifacts


def _get_latest_requirements_artifact(session: Session, project_id: uuid.UUID) -> dict[str, Any]:
    _run, artifacts = _get_latest_run_artifacts(session, project_id)
    for artifact in artifacts:
        if artifact.stage == "requirements" and isinstance(artifact.content, dict):
            return artifact.content
    return {}


def _singularize_name(value: str) -> str:
    text = str(value or "").strip().lower()
    if text.endswith("ies") and len(text) > 3:
        return f"{text[:-3]}y"
    if text.endswith("s") and len(text) > 1:
        return text[:-1]
    return text


def _combine_route_paths(prefix: str, path: str) -> str:
    parts = [str(prefix or "").strip("/"), str(path or "").strip("/")]
    combined = "/".join(part for part in parts if part)
    return f"/{combined}" if combined else "/"


def _sample_value_for_field(field_name: str, field_type: str) -> Any:
    name = str(field_name or "").strip().lower()
    type_name = str(field_type or "").strip().lower()

    if name.endswith("_id") or name == "id":
        return 1
    if "email" in name:
        return "user@example.com"
    if "password" in name:
        return "P@ssw0rd123"
    if "currency" in name:
        return "USD"
    if "url" in name:
        return "https://example.com/sample"
    if "date" in name and "time" not in name:
        return "2026-02-28"
    if "time" in name or name.endswith("_at") or name == "timestamp":
        return "2026-02-28T12:00:00Z"
    if any(token in name for token in ("count", "limit", "offset", "page", "version")):
        return 1
    if name.startswith("is_") or name.startswith("has_") or any(token in name for token in ("active", "completed", "deleted", "enabled")):
        return False
    if any(token in name for token in ("amount", "price", "balance", "total", "cost")):
        return 19.99

    if any(token in type_name for token in ("bool", "boolean")):
        return False
    if any(token in type_name for token in ("int", "integer")):
        return 1
    if any(token in type_name for token in ("float", "double", "decimal", "number")):
        return 19.99
    if "datetime" in type_name:
        return "2026-02-28T12:00:00Z"
    if type_name == "date":
        return "2026-02-28"
    if any(token in type_name for token in ("list", "array")):
        return []

    if name == "title":
        return "Sample title"
    if name == "name":
        return "Sample name"
    if name == "description":
        return "Sample description"
    return "sample"


def _build_entity_samples(requirements_artifact: dict[str, Any]) -> dict[str, dict[str, Any]]:
    entity_samples: dict[str, dict[str, Any]] = {}
    for entity in requirements_artifact.get("entities") or []:
        entity_name = str(entity.get("name") or "").strip()
        if not entity_name:
            continue
        sample: dict[str, Any] = {}
        for field in entity.get("fields") or []:
            field_name = str(field.get("name") or "").strip()
            if not field_name:
                continue
            sample[field_name] = _sample_value_for_field(field_name, str(field.get("field_type") or "str"))
        if "id" not in sample:
            sample["id"] = 1
        entity_samples[_singularize_name(entity_name)] = sample
        entity_samples[entity_name.lower()] = sample
    return entity_samples


def _sample_entity_for_path(path: str, entity_samples: dict[str, dict[str, Any]]) -> dict[str, Any]:
    static_segments = [segment for segment in str(path or "").split("/") if segment and not segment.startswith("{")]
    for segment in reversed(static_segments):
        sample = entity_samples.get(_singularize_name(segment)) or entity_samples.get(segment.lower())
        if sample:
            return dict(sample)
    return {"id": 1, "name": "Sample item", "description": "Sample description"}


def _build_modeled_auth_request_body(path: str) -> dict[str, Any] | None:
    lowered = str(path or "").lower()
    if lowered.endswith("/login"):
        return {"email": "user@example.com", "password": "P@ssw0rd123"}
    if lowered.endswith("/signup") or lowered.endswith("/register"):
        return {"email": "user@example.com", "password": "P@ssw0rd123", "full_name": "Sample User"}
    return None


def _build_modeled_request_body(method: str, path: str, entity_samples: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    if method.upper() not in {"POST", "PUT", "PATCH"}:
        return None
    auth_body = _build_modeled_auth_request_body(path)
    if auth_body is not None:
        return auth_body
    sample = dict(_sample_entity_for_path(path, entity_samples))
    if method.upper() == "POST":
        sample.pop("id", None)
    return sample


def _build_modeled_mock_response(method: str, path: str, entity_samples: dict[str, dict[str, Any]]) -> tuple[int, Any]:
    lowered_path = str(path or "").lower()
    if lowered_path.endswith("/login") or lowered_path.endswith("/signup") or lowered_path.endswith("/register"):
        return 200, {"access_token": "sample-access-token", "token_type": "bearer", "user_id": 1}
    if lowered_path.endswith("/me"):
        return 200, {"id": 1, "email": "user@example.com", "full_name": "Sample User"}
    if "/health" in lowered_path or "/ready" in lowered_path:
        return 200, {"status": "ok"}

    sample = _sample_entity_for_path(path, entity_samples)
    has_path_param = "{" in str(path or "")
    upper_method = method.upper()
    if upper_method == "GET" and not has_path_param:
        return 200, [sample]
    if upper_method == "GET":
        return 200, sample
    if upper_method == "POST":
        return 201, sample
    if upper_method in {"PUT", "PATCH"}:
        return 200, sample
    if upper_method == "DELETE":
        return 200, {"detail": "Deleted successfully"}
    return 200, sample


def _iter_route_parameters(function_node: ast.AST, method: str, path: str) -> list[dict[str, Any]]:
    if not isinstance(function_node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return []
    path_param_names = set(re.findall(r"{([^}]+)}", path))
    args = list(function_node.args.args) + list(function_node.args.kwonlyargs)
    defaults = [None] * (len(args) - len(function_node.args.defaults)) + list(function_node.args.defaults)
    parameters: list[dict[str, Any]] = []

    for arg_node, default_node in zip(args, defaults):
        name = arg_node.arg
        if name in SANDBOX_SKIP_ROUTE_PARAM_NAMES:
            continue
        if isinstance(default_node, ast.Call) and isinstance(default_node.func, ast.Name) and default_node.func.id == "Depends":
            continue
        if name in path_param_names:
            parameters.append(
                {
                    "name": name,
                    "in": "path",
                    "required": True,
                    "label": f"{name} (path)",
                    "description": "Required path parameter.",
                    "placeholder": "1" if name.endswith("id") or name == "id" else "sample",
                }
            )
        elif method.upper() in {"GET", "DELETE"}:
            parameters.append(
                {
                    "name": name,
                    "in": "query",
                    "required": default_node is None,
                    "label": f"{name} (query)",
                    "description": "Modeled query parameter.",
                    "placeholder": "sample",
                }
            )
    return parameters


def _extract_modeled_routes(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    endpoints: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for file_entry in files:
        file_path = str(file_entry.get("path") or "")
        if not file_path.endswith(".py"):
            continue
        try:
            tree = ast.parse(str(file_entry.get("content") or ""), filename=file_path)
        except SyntaxError:
            continue

        router_prefixes: dict[str, str] = {}
        for node in tree.body:
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
                func = node.value.func
                is_api_router = (
                    isinstance(func, ast.Name) and func.id == "APIRouter"
                ) or (
                    isinstance(func, ast.Attribute) and func.attr == "APIRouter"
                )
                if not is_api_router:
                    continue
                prefix = ""
                for keyword in node.value.keywords:
                    if keyword.arg == "prefix" and isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str):
                        prefix = keyword.value.value
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        router_prefixes[target.id] = prefix

        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call):
                    continue
                if not isinstance(decorator.func, ast.Attribute) or not isinstance(decorator.func.value, ast.Name):
                    continue
                method = decorator.func.attr.upper()
                if method not in SANDBOX_TESTER_METHODS:
                    continue
                route_path = "/"
                if decorator.args and isinstance(decorator.args[0], ast.Constant) and isinstance(decorator.args[0].value, str):
                    route_path = decorator.args[0].value
                full_path = _combine_route_paths(router_prefixes.get(decorator.func.value.id, ""), route_path)
                key = (method, full_path)
                if key in seen:
                    continue
                seen.add(key)
                endpoints.append(
                    {
                        "method": method,
                        "path": full_path,
                        "description": ast.get_docstring(node) or node.name.replace("_", " ").strip().title() or f"{method} {full_path}",
                        "parameters": _iter_route_parameters(node, method, full_path),
                    }
                )
    return endpoints


def _build_modeled_tester_payload(session: Session, project_id: uuid.UUID) -> dict[str, Any]:
    code_data = _get_latest_code(session, project_id) or {}
    files = list(code_data.get("files") or [])
    requirements_artifact = _get_latest_requirements_artifact(session, project_id)
    entity_samples = _build_entity_samples(requirements_artifact)
    modeled_routes = _extract_modeled_routes(files)

    if not modeled_routes:
        for endpoint in requirements_artifact.get("endpoints") or []:
            method = str(endpoint.get("method") or "GET").upper()
            path = str(endpoint.get("path") or "/")
            if method not in SANDBOX_TESTER_METHODS:
                continue
            modeled_routes.append(
                {
                    "method": method,
                    "path": path,
                    "description": str(endpoint.get("description") or f"{method} {path}"),
                    "parameters": [
                        {
                            "name": param_name,
                            "in": "path",
                            "required": True,
                            "label": f"{param_name} (path)",
                            "description": "Required path parameter.",
                            "placeholder": "1" if param_name.endswith("id") or param_name == "id" else "sample",
                        }
                        for param_name in re.findall(r"{([^}]+)}", path)
                    ],
                }
            )

    modeled_endpoints: list[dict[str, Any]] = []
    for index, route in enumerate(modeled_routes):
        status_code, mock_response = _build_modeled_mock_response(route["method"], route["path"], entity_samples)
        modeled_endpoints.append(
            {
                "id": f"modeled-{index}-{route['method']}-{route['path']}",
                "method": route["method"],
                "path": route["path"],
                "description": route["description"],
                "parameters": route.get("parameters") or [],
                "requestBodyRequired": route["method"] in {"POST", "PUT", "PATCH"},
                "requestBodyExample": _build_modeled_request_body(route["method"], route["path"], entity_samples),
                "mockResponse": mock_response,
                "mockStatusCode": status_code,
                "mockMode": True,
            }
        )

    return {
        "mode": "modeled",
        "message": "Live sandbox is unavailable. Showing modeled endpoints and sample responses from the latest generated code and requirements.",
        "project_id": str(project_id),
        "endpoints": modeled_endpoints,
    }


def _get_project_for_thread_or_404(thread_id: str, session: Session) -> Project:
    current_user = _get_or_create_chat_bridge_user(session)
    marker = _chat_thread_project_marker(thread_id)
    project = session.exec(
        select(Project).where(
            Project.owner_id == current_user.id,
            Project.description == marker,
        )
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="No project found for this chat thread.")
    return project


def _rewrite_datetime_type_name_collisions(content: str) -> str:
    datetime_import_pattern = re.compile(r"^\s*from\s+datetime\s+import\s+(.+)$")
    lines = content.splitlines()
    imported_names: set[str] = set()
    import_line_indexes: set[int] = set()

    for idx, line in enumerate(lines):
        match = datetime_import_pattern.match(line)
        if not match:
            continue
        import_line_indexes.add(idx)
        for part in match.group(1).split(","):
            segment = part.strip()
            if not segment:
                continue
            if " as " in segment:
                original_name = segment.split(" as ", 1)[0].strip()
            else:
                original_name = segment
            if original_name in {"date", "datetime", "time"}:
                imported_names.add(original_name)

    if not imported_names:
        return content

    collision_names = {
        name
        for name in imported_names
        if re.search(rf"(?m)^\s*{name}\s*:\s*", content)
    }
    if not collision_names:
        return content

    for idx in import_line_indexes:
        line = lines[idx]
        match = datetime_import_pattern.match(line)
        if not match:
            continue
        rewritten_parts: list[str] = []
        for part in match.group(1).split(","):
            segment = part.strip()
            if not segment:
                continue
            if " as " in segment:
                original_name, alias_name = [piece.strip() for piece in segment.split(" as ", 1)]
                if original_name in collision_names:
                    rewritten_parts.append(f"{original_name} as {original_name}_type")
                else:
                    rewritten_parts.append(f"{original_name} as {alias_name}")
            elif segment in collision_names:
                rewritten_parts.append(f"{segment} as {segment}_type")
            else:
                rewritten_parts.append(segment)
        lines[idx] = f"from datetime import {', '.join(rewritten_parts)}"

    rewritten_source = "\n".join(lines)
    tokens = list(tokenize.generate_tokens(StringIO(rewritten_source).readline))
    rewritten_tokens: list[tokenize.TokenInfo] = []

    for token_index, token in enumerate(tokens):
        if token.type == tokenize.NAME and token.string in collision_names:
            if (token.start[0] - 1) in import_line_indexes:
                rewritten_tokens.append(token)
                continue
            next_significant = None
            for lookahead in tokens[token_index + 1:]:
                if lookahead.type in {
                    tokenize.NL,
                    tokenize.NEWLINE,
                    tokenize.INDENT,
                    tokenize.DEDENT,
                    tokenize.COMMENT,
                }:
                    continue
                next_significant = lookahead
                break
            if next_significant and next_significant.string == ":":
                rewritten_tokens.append(token)
                continue
            token = tokenize.TokenInfo(
                token.type,
                f"{token.string}_type",
                token.start,
                token.end,
                token.line,
            )
        rewritten_tokens.append(token)

    return tokenize.untokenize(rewritten_tokens)


def _rewrite_inline_field_sa_column_conflicts(line: str) -> tuple[str, bool]:
    if "Field(" not in line or "sa_column=Column(" not in line:
        return line, False

    rewritten = line
    foreign_key_args: list[str] = []
    field_column_flags: list[str] = []
    requires_foreign_key = False

    foreign_key_match = re.search(r"\bforeign_key\s*=\s*([^,]+),\s*", rewritten)
    if foreign_key_match:
        foreign_key_value = foreign_key_match.group(1).strip()
        foreign_key_args.append(f"ForeignKey({foreign_key_value})")
        requires_foreign_key = True
        rewritten = rewritten[: foreign_key_match.start()] + rewritten[foreign_key_match.end() :]

    for flag_name in ("primary_key", "index", "unique"):
        flag_match = re.search(rf"\b{flag_name}\s*=\s*(True|False),\s*", rewritten)
        if not flag_match:
            continue
        if flag_match.group(1) == "True":
            field_column_flags.append(f"{flag_name}=True")
        rewritten = rewritten[: flag_match.start()] + rewritten[flag_match.end() :]

    rewritten = re.sub(r"\bnullable\s*=\s*(True|False),\s*", "", rewritten)

    if foreign_key_args or field_column_flags:
        rewritten = _inject_sa_column_args(rewritten, foreign_key_args, field_column_flags)

    return rewritten, requires_foreign_key


def _inject_sa_column_args(line: str, foreign_key_args: list[str], field_column_flags: list[str]) -> str:
    column_token = "sa_column=Column("
    column_start = line.find(column_token)
    if column_start == -1:
        return line

    inner_start = column_start + len(column_token)
    depth = 1
    inner_end = inner_start
    while inner_end < len(line):
        char = line[inner_end]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                break
        inner_end += 1

    if inner_end >= len(line):
        return line

    inner = line[inner_start:inner_end]
    split_index = None
    depth = 0
    for idx, char in enumerate(inner):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == "," and depth == 0:
            split_index = idx
            break

    if foreign_key_args:
        foreign_key_segment = ", ".join(foreign_key_args)
        if split_index is None:
            inner = f"{inner}, {foreign_key_segment}"
        else:
            inner = f"{inner[:split_index + 1]} {foreign_key_segment}, {inner[split_index + 1:].lstrip()}"

    if field_column_flags:
        flag_segment = ", ".join(field_column_flags)
        inner = f"{inner}, {flag_segment}"

    return f"{line[:inner_start]}{inner}{line[inner_end:]}"


def _normalize_sandbox_source(path: str, content: str) -> str:
    normalized_path = path.replace("\\", "/").lower()
    normalized = content
    normalized = normalized.replace("from .database import get_db", "from .database import get_db, engine")
    normalized = normalized.replace("bind=get_db().bind", "bind=engine")
    normalized = re.sub(r"@root_validator\s*$", "@root_validator(skip_on_failure=True)", normalized, flags=re.MULTILINE)
    normalized = _rewrite_datetime_type_name_collisions(normalized)

    if normalized_path.endswith(".py"):
        lines = normalized.splitlines()
        rewritten_lines: list[str] = []
        requires_sqlalchemy_foreign_key = False
        idx = 0
        while idx < len(lines):
            line = lines[idx]
            if "Field(" not in line:
                rewritten_lines.append(line)
                idx += 1
                continue

            block = [line]
            balance = line.count("(") - line.count(")")
            if balance <= 0:
                rewritten_line, line_requires_foreign_key = _rewrite_inline_field_sa_column_conflicts(line)
                if "pattern=" in rewritten_line:
                    rewritten_line = rewritten_line.replace("pattern=", "regex=", 1)
                rewritten_lines.append(rewritten_line)
                requires_sqlalchemy_foreign_key = requires_sqlalchemy_foreign_key or line_requires_foreign_key
                idx += 1
                continue
            idx += 1
            while idx < len(lines) and balance > 0:
                block_line = lines[idx]
                block.append(block_line)
                balance += block_line.count("(") - block_line.count(")")
                idx += 1

            has_sa_column = any("sa_column=" in block_line for block_line in block)
            field_column_foreign_keys: list[str] = []
            field_column_flags: list[str] = []
            rewritten_block: list[str] = []
            for block_line in block:
                stripped = block_line.strip()
                if stripped.startswith("pattern="):
                    rewritten_block.append(block_line.replace("pattern=", "regex=", 1))
                    continue
                if has_sa_column and stripped.startswith("nullable="):
                    # sa_column already owns nullability; leaving both can break SQLModel startup.
                    continue
                if has_sa_column:
                    consumed_flag = False
                    for flag_name in ("primary_key", "index", "unique"):
                        if stripped.startswith(f"{flag_name}="):
                            if "true" in stripped.lower():
                                field_column_flags.append(f"{flag_name}=True")
                            consumed_flag = True
                            break
                    if not consumed_flag and stripped.startswith("foreign_key="):
                        foreign_key_value = stripped[len("foreign_key="):].rstrip(",").strip()
                        if foreign_key_value:
                            field_column_foreign_keys.append(f"ForeignKey({foreign_key_value})")
                            requires_sqlalchemy_foreign_key = True
                        consumed_flag = True
                    if consumed_flag:
                        continue
                    rewritten_block.append(block_line)
                    continue
                rewritten_block.append(block_line)

            if has_sa_column and (field_column_foreign_keys or field_column_flags):
                for block_index, block_line in enumerate(rewritten_block):
                    if "sa_column" not in block_line or "Column(" not in block_line:
                        continue
                    rewritten_block[block_index] = _inject_sa_column_args(
                        block_line,
                        field_column_foreign_keys,
                        list(dict.fromkeys(field_column_flags)),
                    )
                    break

            rewritten_lines.extend(rewritten_block)

        normalized = "\n".join(rewritten_lines)
        if requires_sqlalchemy_foreign_key:
            sqlalchemy_import_pattern = re.compile(r"(?m)^from\s+sqlalchemy\s+import\s+(.+)$")
            sqlalchemy_import_match = sqlalchemy_import_pattern.search(normalized)
            if sqlalchemy_import_match:
                imported_symbols = [part.strip() for part in sqlalchemy_import_match.group(1).split(",") if part.strip()]
                if "ForeignKey" not in imported_symbols:
                    imported_symbols.append("ForeignKey")
                    normalized = sqlalchemy_import_pattern.sub(
                        f"from sqlalchemy import {', '.join(imported_symbols)}",
                        normalized,
                        count=1,
                    )
            else:
                normalized = "from sqlalchemy import ForeignKey\n" + normalized

    if normalized_path.endswith("database.py") and "def get_engine" in normalized:
        has_top_level_engine = bool(re.search(r"(?m)^engine\s*=", normalized))
        if not has_top_level_engine:
            normalized = (
                normalized.rstrip()
                + "\n\n# Expose a module-level engine for generated apps that import it directly.\n"
                + "engine = get_engine()\n"
            )

    if normalized_path.endswith("schemas.py"):
        has_create_model = "class CalculationCreate(" in normalized
        has_request_model = "class CalculationRequest(" in normalized or re.search(
            r"(?m)^CalculationRequest\s*=",
            normalized,
        )
        if has_create_model and not has_request_model:
            normalized = (
                normalized.rstrip()
                + "\n\n# Backwards-compatible alias used by some generated route modules.\n"
                + "CalculationRequest = CalculationCreate\n"
            )

        # Common auth-schema drift in generated apps.
        has_token_model = "class Token(" in normalized or re.search(r"(?m)^Token\s*=", normalized)
        has_token_response = "class TokenResponse(" in normalized or re.search(r"(?m)^TokenResponse\s*=", normalized)
        has_login_request = "class LoginRequest(" in normalized or re.search(r"(?m)^LoginRequest\s*=", normalized)
        has_token_request = "class TokenRequest(" in normalized or re.search(r"(?m)^TokenRequest\s*=", normalized)
        auth_aliases: list[str] = []
        if has_token_model and not has_token_response:
            auth_aliases.append("TokenResponse = Token")
        if has_login_request and not has_token_request:
            auth_aliases.append("TokenRequest = LoginRequest")
        if auth_aliases:
            normalized = (
                normalized.rstrip()
                + "\n\n# Backwards-compatible aliases used by generated route modules.\n"
                + "\n".join(auth_aliases)
                + "\n"
            )

    if normalized_path.endswith("routes.py"):
        has_router_list = re.search(r"(?m)^router_list\s*=\s*\[", normalized) is not None
        has_api_router = re.search(r"(?m)^api_router\s*=", normalized) is not None
        has_get_router = re.search(r"(?m)^def\s+get_router\s*\(", normalized) is not None
        if has_router_list and not has_api_router:
            normalized = (
                normalized.rstrip()
                + "\n\n# Sandbox compatibility export for generated route modules.\n"
                + "api_router = APIRouter()\n"
                + "for _router in router_list:\n"
                + "    api_router.include_router(_router)\n"
            )
        if has_router_list and not has_get_router:
            normalized = (
                normalized.rstrip()
                + "\n\n"
                + "def get_router():\n"
                + "    return api_router\n"
            )

    if normalized_path.endswith("auth.py"):
        if "def create_access_token(*, subject:" in normalized and "def _sandbox_create_access_token_impl(" not in normalized:
            normalized = normalized.replace(
                "def create_access_token(",
                "def _sandbox_create_access_token_impl(",
                1,
            )

        auth_aliases: list[str] = []
        has_hash_password = "def hash_password(" in normalized or re.search(r"(?m)^hash_password\s*=", normalized)
        has_get_password_hash = "def get_password_hash(" in normalized or re.search(r"(?m)^get_password_hash\s*=", normalized)
        has_get_current_user = "def get_current_user(" in normalized or re.search(r"(?m)^get_current_user\s*=", normalized)
        has_current_user = "def current_user(" in normalized or re.search(r"(?m)^current_user\s*=", normalized)
        if has_hash_password and not has_get_password_hash:
            auth_aliases.append("get_password_hash = hash_password")
        if has_get_current_user and not has_current_user:
            auth_aliases.append("current_user = get_current_user")
        if "def _sandbox_create_access_token_impl(" in normalized:
            auth_aliases.append(
                "def create_access_token(subject=None, expires_delta=None):\n"
                "    if isinstance(subject, dict):\n"
                "        subject = subject.get('sub')\n"
                "    return _sandbox_create_access_token_impl(subject=str(subject), expires_delta=expires_delta)"
            )
        if auth_aliases:
            normalized = (
                normalized.rstrip()
                + "\n\n# Backwards-compatible aliases used by generated route modules.\n"
                + "\n".join(auth_aliases)
                + "\n"
            )

    if normalized_path.endswith("services.py"):
        if "def list_calculations(" in normalized and "def _sandbox_list_calculations_impl(" not in normalized:
            normalized = normalized.replace("def list_calculations(", "def _sandbox_list_calculations_impl(", 1)

        if "def evaluate_calculation(" not in normalized and "class CalculatorService" in normalized:
            normalized = (
                normalized.rstrip()
                + """


# Compatibility wrappers for generated route modules that target an earlier service surface.
_calculator_service = CalculatorService()


def evaluate_calculation(*, db: Session, request: Any, store: bool = True):
    payload = request.model_dump() if hasattr(request, "model_dump") else request.dict()
    return _calculator_service.evaluate(
        expression=payload.get("expression"),
        operator=payload.get("operator"),
        operands=payload.get("operands"),
        store=store,
        session=db,
    )


def list_calculations(
    *,
    db: Session | None = None,
    filters: Optional[Dict[str, Any]] = None,
    session: Optional[Session] = None,
    limit: int = 100,
    offset: int = 0,
    operator: Optional[str] = None,
    from_dt: Optional[datetime] = None,
    to_dt: Optional[datetime] = None,
):
    active_session = db or session
    if active_session is None:
        raise PersistenceError("No database session provided")

    filter_values = filters or {}
    return _sandbox_list_calculations_impl(
        session=active_session,
        limit=filter_values.get("limit", limit),
        offset=filter_values.get("offset", offset),
        operator=filter_values.get("operator", operator),
        from_dt=filter_values.get("from", from_dt),
        to_dt=filter_values.get("to", to_dt),
    )


def get_calculation(*, db: Session, calculation_id: Union[str, uuid.UUID]):
    return get_calculation_by_id(session=db, calculation_id=calculation_id)


def delete_calculation(*, db: Session, calculation_id: Union[str, uuid.UUID]) -> bool:
    summary = delete_calculation_by_id(session=db, calculation_id=calculation_id)
    return bool(summary.get("deleted"))


def clear_calculations(*, db: Session) -> int:
    summary = clear_all_calculations(session=db)
    return int(summary.get("deleted", 0))


def get_operators() -> Dict[str, Any]:
    return {
        "operators": [
            {"symbol": "+", "arity": "binary", "description": "Addition"},
            {"symbol": "-", "arity": "binary", "description": "Subtraction"},
            {"symbol": "*", "arity": "binary", "description": "Multiplication"},
            {"symbol": "/", "arity": "binary", "description": "Division"},
            {"symbol": "%", "arity": "binary", "description": "Modulo"},
            {"symbol": "^", "arity": "binary", "description": "Exponentiation"},
        ]
    }


def health_check(*, db: Session) -> bool:
    try:
        db.exec(select(Calculation).limit(1)).all()
        return True
    except Exception as exc:
        raise PersistenceError(f"Health check failed: {exc}") from exc
"""
            )

    if normalized_path.endswith("service.py"):
        todo_markers = (
            "def create_todo(" in normalized
            and "def list_todos(" in normalized
            and "TodoCreate" in normalized
            and "repository" in normalized
        )
        if todo_markers and "def _sandbox_create_todo_impl(" not in normalized:
            normalized = normalized.replace("def create_todo(", "def _sandbox_create_todo_impl(", 1)
            normalized = normalized.replace("def get_todo(", "def _sandbox_get_todo_impl(", 1)
            normalized = normalized.replace("def list_todos(", "def _sandbox_list_todos_impl(", 1)
            normalized = normalized.replace("def replace_todo(", "def _sandbox_replace_todo_impl(", 1)
            normalized = normalized.replace("def patch_todo(", "def _sandbox_patch_todo_impl(", 1)
            normalized = normalized.replace("def delete_todo(", "def _sandbox_delete_todo_impl(", 1)
            if "PreconditionFailed = PreconditionFailedError" not in normalized:
                normalized = normalized.replace(
                    "class PreconditionFailedError(ServiceError):",
                    "class PreconditionFailedError(ServiceError):",
                    1,
                )
                normalized = normalized.rstrip() + """


PreconditionFailed = PreconditionFailedError


def create_todo(*, db=None, session=None, todo_in: schemas.TodoCreate):
    return _sandbox_create_todo_impl(db=session or db, todo_in=todo_in)


def get_todo(*, db=None, session=None, todo_id: int):
    return _sandbox_get_todo_impl(db=session or db, todo_id=todo_id)


def list_todos(
    *,
    db=None,
    session=None,
    completed: Optional[bool] = None,
    due_date_before: Optional[datetime.datetime] = None,
    due_date_after: Optional[datetime.datetime] = None,
    due_before: Optional[datetime.datetime] = None,
    due_after: Optional[datetime.datetime] = None,
    limit: Optional[int] = 100,
    offset: Optional[int] = 0,
):
    return _sandbox_list_todos_impl(
        db=session or db,
        completed=completed,
        due_before=due_date_before if due_date_before is not None else due_before,
        due_after=due_date_after if due_date_after is not None else due_after,
        limit=limit,
        offset=offset,
    )


def update_todo(*, db=None, session=None, todo_id: int, todo_in: schemas.TodoUpdate, if_unmodified_since: Optional[datetime.datetime] = None):
    return _sandbox_replace_todo_impl(
        db=session or db,
        todo_id=todo_id,
        todo_in=todo_in,
        if_unmodified_since=if_unmodified_since,
    )


def replace_todo(*, db=None, session=None, todo_id: int, todo_in: schemas.TodoUpdate, if_unmodified_since: Optional[datetime.datetime] = None):
    return _sandbox_replace_todo_impl(
        db=session or db,
        todo_id=todo_id,
        todo_in=todo_in,
        if_unmodified_since=if_unmodified_since,
    )


def patch_todo(*, db=None, session=None, todo_id: int, todo_in: schemas.TodoPatch, if_unmodified_since: Optional[datetime.datetime] = None):
    return _sandbox_patch_todo_impl(
        db=session or db,
        todo_id=todo_id,
        todo_in=todo_in,
        if_unmodified_since=if_unmodified_since,
    )


def delete_todo(*, db=None, session=None, todo_id: int):
    return _sandbox_delete_todo_impl(db=session or db, todo_id=todo_id)
"""

    if normalized_path.endswith("repository.py"):
        todo_repo_markers = (
            "def get_todo_by_id(" in normalized
            and "def list_todos(" in normalized
            and "def update_todo(" in normalized
            and "models.Todo" in normalized
        )
        if todo_repo_markers and "def _sandbox_repo_list_todos_impl(" not in normalized:
            normalized = normalized.replace("def list_todos(", "def _sandbox_repo_list_todos_impl(", 1)
            normalized = normalized.replace("def update_todo(", "def _sandbox_repo_update_todo_impl(", 1)
            normalized = normalized.rstrip() + """


def get_todo(session: Session, todo_id: int) -> Optional[models.Todo]:
    return get_todo_by_id(session, todo_id)


def list_todos(
    session: Session,
    *,
    completed: Optional[bool] = None,
    due_before: Optional[datetime] = None,
    due_after: Optional[datetime] = None,
    due_date_before: Optional[datetime] = None,
    due_date_after: Optional[datetime] = None,
    limit: int = 100,
    offset: int = 0,
) -> List[models.Todo]:
    return _sandbox_repo_list_todos_impl(
        session,
        completed=completed,
        due_date_before=due_date_before if due_date_before is not None else due_before,
        due_date_after=due_date_after if due_date_after is not None else due_after,
        limit=limit,
        offset=offset,
    )


def update_todo(session: Session, *args) -> Optional[models.Todo]:
    if len(args) == 1:
        new_todo = args[0]
        todo_id = getattr(new_todo, "id", None)
        if todo_id is None:
            raise ValueError("todo_id is required to update a todo")
        return _sandbox_repo_update_todo_impl(session, todo_id, new_todo)
    if len(args) == 2:
        todo_id, new_todo = args
        return _sandbox_repo_update_todo_impl(session, todo_id, new_todo)
    raise TypeError("update_todo expected (session, new_todo) or (session, todo_id, new_todo)")
"""

    return normalized


def _build_internal_sandbox_url(project_id: uuid.UUID, path: str, query_params: dict[str, Any] | None = None) -> str:
    base = _sandbox_internal_base_url(project_id)
    if not base:
        raise HTTPException(status_code=409, detail="Sandbox is not running for this thread.")
    normalized_path = f"/{str(path or '').lstrip('/')}"
    query = urlencode(
        [(key, value) for key, value in (query_params or {}).items() if value is not None],
        doseq=True,
    )
    base = base.rstrip("/")
    return f"{base}{normalized_path}" + (f"?{query}" if query else "")


def _fetch_sandbox_json(url: str) -> Any:
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(url)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Sandbox returned {exc.response.status_code}.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Failed to contact the sandbox.") from exc


def _require_active_sandbox_for_project(project_id: uuid.UUID) -> SandboxStatus:
    status = _build_sandbox_status(project_id)
    if status.status != "running":
        detail = status.error or status.message or "Sandbox is not running for this thread."
        raise HTTPException(status_code=409, detail=detail)
    return status


def _augment_sandbox_dependencies(files: list[dict[str, Any]], dependencies: list[str]) -> set[str]:
    normalized_dependencies = {str(dep).strip() for dep in dependencies if str(dep).strip()}
    source_blob = "\n".join(str(file_entry.get("content") or "") for file_entry in files)

    if "EmailStr" in source_blob:
        has_email_dep = any(
            dep == "email-validator" or dep.startswith("pydantic[email]")
            for dep in normalized_dependencies
        )
        if not has_email_dep:
            normalized_dependencies.add("email-validator")

    return normalized_dependencies


def _remove_duplicate_field_indexes(content: str) -> str:
    explicit_index_fields = {
        match.group(1)
        for match in re.finditer(
            r'Index\(\s*["\']ix_[^"\']+["\']\s*,\s*["\']([A-Za-z_][A-Za-z0-9_]*)["\']',
            content,
        )
    }
    if not explicit_index_fields:
        return content

    lines = content.splitlines()
    rewritten_lines: list[str] = []
    idx = 0
    while idx < len(lines):
        line = lines[idx]
        field_match = re.match(r"^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*.*Field\(", line)
        if not field_match:
            rewritten_lines.append(line)
            idx += 1
            continue

        field_name = field_match.group(2)
        block = [line]
        balance = line.count("(") - line.count(")")
        idx += 1
        while idx < len(lines) and balance > 0:
            block_line = lines[idx]
            block.append(block_line)
            balance += block_line.count("(") - block_line.count(")")
            idx += 1

        if field_name in explicit_index_fields:
            rewritten_block: list[str] = []
            for block_line in block:
                stripped = block_line.strip()
                if stripped.startswith("index="):
                    continue
                if "Field(" in block_line or "index=" in block_line:
                    block_line = re.sub(r",\s*index\s*=\s*True", "", block_line)
                    block_line = re.sub(r"index\s*=\s*True,\s*", "", block_line)
                rewritten_block.append(block_line)
            block = rewritten_block

        rewritten_lines.extend(block)

    return "\n".join(rewritten_lines)


def _dedupe_sandbox_schema_bootstrap(sandbox_dir: Path) -> None:
    database_path = sandbox_dir / "app" / "database.py"
    main_path = sandbox_dir / "app" / "main.py"
    if not database_path.exists() or not main_path.exists():
        return

    database_source = database_path.read_text(encoding="utf-8")
    if "SQLModel.metadata.create_all(" not in database_source:
        return

    main_source = main_path.read_text(encoding="utf-8")
    normalized_main = re.sub(
        r"(?m)^\s*SQLModel\.metadata\.create_all\(engine\)\s*$\n?",
        "",
        main_source,
    )
    if normalized_main != main_source:
        main_path.write_text(normalized_main, encoding="utf-8", newline="\n")


def _dedupe_router_prefixes(sandbox_dir: Path) -> None:
    routes_path = sandbox_dir / "app" / "routes.py"
    main_path = sandbox_dir / "app" / "main.py"
    if not routes_path.exists() or not main_path.exists():
        return

    route_source = routes_path.read_text(encoding="utf-8")
    router_prefixes = {
        match.group("name"): match.group("prefix")
        for match in re.finditer(
            r'(?m)^(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*APIRouter\(\s*prefix\s*=\s*["\'](?P<prefix>/[^"\']*)["\']',
            route_source,
        )
    }
    if not router_prefixes:
        return

    main_source = main_path.read_text(encoding="utf-8")
    normalized_main = main_source
    for router_name, prefix in router_prefixes.items():
        normalized_main = re.sub(
            rf'(?m)(app\.include_router\(\s*{re.escape(router_name)}\s*,\s*)prefix\s*=\s*["\']{re.escape(prefix)}["\']\s*,\s*',
            r"\1",
            normalized_main,
        )

    if normalized_main != main_source:
        main_path.write_text(normalized_main, encoding="utf-8", newline="\n")


def _write_sandbox_bundle(
    project_id: uuid.UUID,
    files: list[dict[str, Any]],
    dependencies: list[str],
    *,
    normalize_generated_code: bool = True,
) -> None:
    sandbox_dir = _sandbox_host_dir(project_id)
    db_token = uuid.uuid4().hex[:8]
    if sandbox_dir.exists():
        shutil.rmtree(sandbox_dir)
    sandbox_dir.mkdir(parents=True, exist_ok=True)

    for file_entry in files:
        relative_path = str(file_entry["path"]).replace("\\", "/").lstrip("/")
        file_path = sandbox_dir / relative_path
        file_path.parent.mkdir(parents=True, exist_ok=True)

        raw_content = str(file_entry.get("content") or "")
        content = (
            _normalize_sandbox_source(relative_path, raw_content)
            if normalize_generated_code
            else raw_content
        )

        file_path.write_text(content, encoding="utf-8")
        logger.info("Wrote sandbox file: %s", file_path)

    if normalize_generated_code:
        for model_path in sandbox_dir.rglob("models.py"):
            source = model_path.read_text(encoding="utf-8")
            rewritten = _remove_duplicate_field_indexes(source)
            if rewritten != source:
                model_path.write_text(rewritten, encoding="utf-8", newline="\n")

    if normalize_generated_code:
        # Ensure app/exceptions.py exists to prevent import errors in generated code
        exceptions_path = sandbox_dir / "app" / "exceptions.py"
        if not exceptions_path.exists():
            exceptions_path.parent.mkdir(parents=True, exist_ok=True)
            exceptions_path.write_text(
                "class NotFoundError(Exception):\n"
                "    pass\n\n"
                "class DomainValidationError(Exception):\n"
                "    pass\n\n"
                "class ValidationError(Exception):\n"
                "    pass\n",
                encoding="utf-8"
            )
            logger.info("Wrote fallback exceptions file: %s", exceptions_path)

        _dedupe_sandbox_schema_bootstrap(sandbox_dir)
        _dedupe_router_prefixes(sandbox_dir)

    inferred_deps = _augment_sandbox_dependencies(files, dependencies) if normalize_generated_code else {
        str(dep).strip() for dep in dependencies if str(dep).strip()
    }
    base_deps = {"fastapi", "uvicorn[standard]", "sqlmodel"}
    reqs_path = sandbox_dir / "requirements.txt"
    reqs_path.write_text("\n".join(sorted(base_deps | inferred_deps)), encoding="utf-8", newline="\n")

    env_path = _sandbox_env_host_path(project_id)
    env_path.write_text(
        "\n".join(
            [
                "PORT=9000",
                f"DATABASE_URL=sqlite:////tmp/sandbox-{project_id}-{db_token}.db",
                f"AUTH_DATABASE_URL=sqlite:////tmp/auth-{project_id}-{db_token}.db",
                "SECRET_KEY=sandbox-secret-key",
                "ACCESS_TOKEN_EXPIRE_MINUTES=60",
            ]
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )

    sandbox_container_dir = SANDBOX_CONTAINER_WORKDIR
    launcher = sandbox_dir / "container_entrypoint.sh"
    launcher.write_text(
        f"""#!/bin/sh
set -e
echo "Preparing sandbox for project {project_id}"
cd "{sandbox_container_dir}"
set -a
[ -f ".env" ] && . "./.env"
set +a
python -m pip install -q -r requirements.txt

if [ -f "app/main.py" ]; then
    MODULE="app.main:app"
elif [ -f "main.py" ]; then
    MODULE="main:app"
else
    MODULE=$(grep -rl "FastAPI()" . --include="*.py" | head -1 | sed 's|^./||;s|/|.|g;s|.py$||'):app
fi

echo "Launching uvicorn module $MODULE"
exec uvicorn "$MODULE" --host 0.0.0.0 --port "${{PORT:-9000}}"
""",
        encoding="utf-8",
        newline="\n",
    )
    launcher.chmod(0o755)


def _launch_project_sandbox(project_id: uuid.UUID, *, sandbox_mode: str = "normalized") -> None:
    sandbox_dir = _sandbox_host_dir(project_id).resolve()
    container_name = _sandbox_container_name(project_id)
    _stop_project_sandbox(project_id)
    # Defensively clear any stale container with the same name even if runtime metadata was stale.
    _docker_cmd("rm", "-f", container_name, check=False)
    port = _allocate_sandbox_port(project_id)

    runtime_info = {
        "project_id": str(project_id),
        "container_name": container_name,
        "port": port,
        "mode": sandbox_mode,
        "host_dir": str(sandbox_dir),
        "started_at": int(time.time()),
    }
    _write_runtime_info(project_id, runtime_info)

    docker_run_args = (
        "run",
        "-d",
        "--name",
        container_name,
        "-p",
        f"{port}:9000",
        "-v",
        f"{sandbox_dir}:{SANDBOX_CONTAINER_WORKDIR}",
        "-w",
        SANDBOX_CONTAINER_WORKDIR,
        SANDBOX_DOCKER_IMAGE,
        "sh",
        f"{SANDBOX_CONTAINER_WORKDIR}/container_entrypoint.sh",
    )
    result = _docker_cmd(*docker_run_args, check=False)
    stderr = (result.stderr or result.stdout or "").strip()
    if result.returncode != 0 and "is already in use" in stderr:
        _docker_cmd("rm", "-f", container_name, check=False)
        result = _docker_cmd(*docker_run_args, check=False)
    if result.returncode != 0:
        _delete_runtime_info(project_id)
        stderr = (result.stderr or result.stdout or "Failed to start sandbox container.").strip()
        raise HTTPException(status_code=500, detail=stderr)

    runtime_info["container_id"] = result.stdout.strip()
    _write_runtime_info(project_id, runtime_info)


def _deploy_project_to_sandbox(project_id: uuid.UUID, session: Session, *, raw: bool = False) -> SandboxStatus:
    code_data = _get_latest_code(session, project_id)
    if not code_data or not code_data.get("files"):
        raise HTTPException(
            status_code=400,
            detail="No generated code found for this project. Run the pipeline first.",
        )

    files = code_data["files"]
    dependencies = code_data.get("dependencies", [])
    sandbox_mode = "raw" if raw else "normalized"
    _validate_python_sources(files)
    _write_sandbox_bundle(
        project_id,
        files,
        dependencies,
        normalize_generated_code=not raw,
    )
    _launch_project_sandbox(project_id, sandbox_mode=sandbox_mode)

    is_ready = _wait_for_sandbox(project_id)
    if is_ready:
        port = (_read_runtime_info(project_id) or {}).get("port")
        return SandboxStatus(
            status="running",
            message=f"Sandbox API is live for project {project_id} ({sandbox_mode} mode).",
            swagger_url=_build_project_docs_url(port) if isinstance(port, int) else None,
            project_id=str(project_id),
            sandbox_mode=sandbox_mode,
        )

    status = _build_sandbox_status(project_id)
    if status.status == "stopped":
        port = (_read_runtime_info(project_id) or {}).get("port")
        return SandboxStatus(
            status="deploying",
            message=f"Sandbox deployment started in {sandbox_mode} mode. The API may still be installing dependencies.",
            swagger_url=_build_project_docs_url(port) if isinstance(port, int) else None,
            project_id=str(project_id),
            sandbox_mode=sandbox_mode,
            logs=status.logs,
        )
    return status


@router.post("/deploy/{project_id}", response_model=SandboxStatus)
def deploy_to_sandbox(
    project_id: uuid.UUID,
    raw: bool = False,
    session: Session = Depends(get_db),
    current_user: CurrentUser = None,
) -> Any:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return _deploy_project_to_sandbox(project_id, session, raw=raw)


@router.post("/deploy-by-thread/{thread_id}", response_model=SandboxStatus)
def deploy_to_sandbox_by_thread(
    thread_id: str,
    raw: bool = False,
    session: Session = Depends(get_db),
) -> Any:
    project = _get_project_for_thread_or_404(thread_id, session)
    return _deploy_project_to_sandbox(project.id, session, raw=raw)


@router.get("/status", response_model=SandboxStatus)
def get_sandbox_status() -> Any:
    return _build_sandbox_status()


@router.get("/status-by-thread/{thread_id}", response_model=SandboxStatus)
def get_sandbox_status_by_thread(
    thread_id: str,
    session: Session = Depends(get_db),
) -> Any:
    project = _get_project_for_thread_or_404(thread_id, session)
    return _build_sandbox_status(project.id)


@router.get("/openapi-by-thread/{thread_id}")
def get_sandbox_openapi_by_thread(
    thread_id: str,
    session: Session = Depends(get_db),
) -> Any:
    project = _get_project_for_thread_or_404(thread_id, session)
    _require_active_sandbox_for_project(project.id)
    runtime_info = _read_runtime_info(project.id) or {}
    port = runtime_info.get("port")
    if not isinstance(port, int):
        raise HTTPException(status_code=409, detail="Sandbox is not running for this thread.")
    spec = _fetch_sandbox_json(_build_project_openapi_url(port))
    if _openapi_looks_like_fallback(spec):
        logs = _sandbox_logs(project.id) or ""
        detail = "Live sandbox started, but generated API routes failed to load."
        if "failed to import or include routers" in logs.lower():
            detail = "Live sandbox started a fallback shell app because generated routes failed to import."
        raise HTTPException(status_code=502, detail=detail)
    return spec


@router.get("/modeled-endpoints-by-thread/{thread_id}")
def get_modeled_tester_endpoints_by_thread(
    thread_id: str,
    session: Session = Depends(get_db),
) -> Any:
    project = _get_project_for_thread_or_404(thread_id, session)
    return _build_modeled_tester_payload(session, project.id)


@router.post("/proxy-by-thread/{thread_id}")
def proxy_sandbox_request_by_thread(
    thread_id: str,
    payload: SandboxProxyRequest,
    session: Session = Depends(get_db),
) -> Any:
    project = _get_project_for_thread_or_404(thread_id, session)
    _require_active_sandbox_for_project(project.id)

    resolved_path = str(payload.path or "").strip() or "/"
    for key, value in payload.path_params.items():
        resolved_path = resolved_path.replace(f"{{{key}}}", quote(str(value), safe=""))

    request_kwargs: dict[str, Any] = {
        "method": payload.method.upper(),
        "url": _build_internal_sandbox_url(project.id, resolved_path, payload.query_params),
        "timeout": 20.0,
    }
    if payload.json_body is not None and payload.method.upper() in {"POST", "PUT", "PATCH", "DELETE"}:
        request_kwargs["json"] = payload.json_body

    try:
        with httpx.Client() as client:
            response = client.request(**request_kwargs)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Failed to proxy the sandbox request.") from exc

    content_type = response.headers.get("content-type", "")
    try:
        response_body = response.json()
    except ValueError:
        response_body = response.text

    return {
        "ok": response.is_success,
        "status_code": response.status_code,
        "content_type": content_type,
        "body": response_body,
    }
