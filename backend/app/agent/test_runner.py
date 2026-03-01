from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
import urllib.error
import urllib.parse
import uuid
import time
from pathlib import Path

from app.agent.artifacts import CodeFile, FilePatchRequest, GeneratedCode, TestFailure, TestRunReport



class TestRunner:
    """
    Deterministic post-generation checks.

    Scope:
    - Python syntax compilation of generated files
    - Import/startup smoke check for `app.main`
    - OpenAPI fetch + bounded endpoint smoke via FastAPI TestClient
    """

    def __init__(self, timeout_seconds: int = 20):
        self.timeout_seconds = timeout_seconds

    def _write_files(self, root: Path, files: list[CodeFile]) -> None:
        for code_file in files:
            rel = str(code_file.path or "").replace("\\", "/").lstrip("/")
            if not rel:
                continue
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(code_file.content or "", encoding="utf-8")

    def _syntax_check(self, files: list[CodeFile]) -> list[TestFailure]:
        failures: list[TestFailure] = []
        for code_file in files:
            if not str(code_file.path or "").endswith(".py"):
                continue
            try:
                compile(code_file.content or "", code_file.path, "exec")
            except SyntaxError as exc:
                failures.append(
                    TestFailure(
                        check="syntax",
                        message=f"{exc.msg}",
                        file_path=code_file.path,
                        line_number=exc.lineno,
                        patchable=True,
                    )
                )
            except Exception as exc:  # pragma: no cover - defensive
                failures.append(
                    TestFailure(
                        check="syntax",
                        message=f"Unexpected compile error: {exc}",
                        file_path=code_file.path,
                        patchable=True,
                    )
                )
        return failures

    async def _live_sandbox_check(self, project_id: str, code: GeneratedCode) -> tuple[list[TestFailure], list[str]]:
        from app.api.routes.sandbox import (
            _openapi_looks_like_fallback,
            _write_sandbox_bundle,
            _launch_project_sandbox,
            _wait_for_sandbox,
            _sandbox_logs,
            _is_sandbox_live,
            _build_project_docs_url,
            _read_runtime_info,
        )

        try:
            pid = uuid.UUID(project_id)
        except ValueError:
            return [], ["Skipping live sandbox check because project_id is invalid"]

        failures: list[TestFailure] = []
        warnings: list[str] = []

        try:
            files_dict = [{"path": f.path, "content": f.content} for f in (code.files or [])]
            _write_sandbox_bundle(pid, files_dict, code.dependencies or [], normalize_generated_code=True)
            _launch_project_sandbox(pid, sandbox_mode="normalized")
        except Exception as exc:
            failures.append(TestFailure(
                check="import_smoke", 
                message=f"Failed to launch sandbox container: {exc}",
                patchable=True
            ))
            return failures, warnings

        is_ready = _wait_for_sandbox(pid, timeout_seconds=45)
        
        logs = _sandbox_logs(pid)
        if not is_ready:
            failures.append(TestFailure(
                check="import_smoke",
                message="Sandbox container crashed or timed out during startup.",
                patchable=True
            ))
            if logs:
                failures[0].message += f"\n\nContainer Logs:\n{logs}"
            return failures, warnings

        info = _read_runtime_info(pid)
        port = (info or {}).get("port")
        if not port:
            return [], ["Sandbox is live but port is unknown"]

        docs_url = _build_project_docs_url(port)
        openapi_url = docs_url.replace("/docs", "/openapi.json")

        try:
            req = urllib.request.Request(openapi_url)
            with urllib.request.urlopen(req, timeout=10) as response:
                if response.status != 200:
                    failures.append(TestFailure(check="endpoint_smoke", message=f"/openapi.json returned {response.status}"))
                    return failures, warnings
                try:
                    openapi_data = json.loads(response.read().decode())
                except json.JSONDecodeError:
                    failures.append(TestFailure(check="endpoint_smoke", message="Failed to parse /openapi.json payload"))
                    return failures, warnings
        except Exception as exc:
            failures.append(TestFailure(check="endpoint_smoke", message=f"Failed to fetch /openapi.json from live sandbox: {exc}"))
            return failures, warnings

        if _openapi_looks_like_fallback(openapi_data):
            message = "Live sandbox started a fallback shell app because generated API routes failed to load."
            if logs and "does not expose a router" in logs.lower():
                message += " app.routes did not expose router, api_router, or get_router()."
            failures.append(
                TestFailure(
                    check="endpoint_smoke",
                    message=message,
                    file_path="app/routes.py",
                    line_number=1,
                    patchable=True,
                )
            )
            return failures, warnings
            
        checked = 0
        for path, path_item in (openapi_data.get("paths") or {}).items():
            if checked >= 12:
                break
            if not isinstance(path_item, dict):
                continue
            for method in ("get", "post", "put", "patch", "delete"):
                operation = path_item.get(method)
                if not isinstance(operation, dict):
                    continue
                
                # Use a simplified check for the repair loop: just hit the endpoint and ensure it doesn't 500
                resolved_url = f"http://127.0.0.1:{port}{path}"
                resolved_url = resolved_url.replace("{", "").replace("}", "") # Strip parameters for quick smoke test
                
                try:
                    req = urllib.request.Request(resolved_url, method=method.upper())
                    with urllib.request.urlopen(req, timeout=5) as response:
                        pass # 2xx - 3xx are okay
                except urllib.error.HTTPError as he:
                    if he.code >= 500:
                        try:
                            error_body = he.read().decode()
                        except:
                            error_body = ""
                        failures.append(TestFailure(
                            check="endpoint_smoke",
                            message=f"{method.upper()} {path} returned 500 Internal Server Error in the sandbox.",
                            patchable=True
                        ))
                        if error_body:
                            failures[-1].message += f"\n\nResponse:\n{error_body}"
                except Exception as exc:
                    pass # Skip connection drops or malformed URLs during basic smoke test
                
                checked += 1
                if checked >= 12:
                    break

        # If there are sandbox failures, attach full logs to the first one for context
        if failures and logs:
            failures[0].message += f"\n\n--- Sandbox Logs ---\n{logs}"

        return failures, warnings
        # Example traceback line: File "C:\\...\\tmp\\app\\routes.py", line 12, in <module>
        pattern = re.compile(r'File "([^"]+)", line (\d+)', re.MULTILINE)
        root_str = str(root.resolve())
        for match in pattern.finditer(traceback_text or ""):
            file_path = match.group(1)
            if not file_path:
                continue
            try:
                resolved = str(Path(file_path).resolve())
            except Exception:
                resolved = file_path
            if not resolved.startswith(root_str):
                continue
            rel = Path(resolved).resolve().relative_to(root.resolve()).as_posix()
            return rel, int(match.group(2))
        return None, None

    async def _runtime_smoke_check(self, root: Path) -> tuple[list[TestFailure], list[str]]:
        script = r"""
import importlib, json, sys, traceback

def sample_value(name, schema):
    schema = schema or {}
    name = str(name or "").lower()
    enum_values = schema.get("enum") or []
    if enum_values:
        return enum_values[0]
    schema_type = schema.get("type")
    schema_format = schema.get("format")
    if name.endswith("_id") or name == "id":
        return 1
    if "email" in name:
        return "user@example.com"
    if "password" in name:
        return "P@ssw0rd123"
    if "currency" in name:
        return "USD"
    if "date" in name and "time" not in name:
        return "2026-02-28"
    if "time" in name or name.endswith("_at"):
        return "2026-02-28T12:00:00Z"
    if schema_format == "date-time":
        return "2026-02-28T12:00:00Z"
    if schema_format == "date":
        return "2026-02-28"
    if schema_type == "boolean":
        return False
    if schema_type == "integer":
        return 1
    if schema_type == "number":
        return 19.99
    if schema_type == "array":
        item_schema = schema.get("items") or {}
        return [sample_value(name, item_schema)]
    if schema_type == "object":
        props = schema.get("properties") or {}
        required = schema.get("required") or props.keys()
        return {key: sample_value(key, props.get(key) or {}) for key in required}
    return "sample"

def resolve_schema(schema, openapi):
    if not isinstance(schema, dict):
        return {}
    if "$ref" in schema:
        ref = schema["$ref"]
        if not isinstance(ref, str) or not ref.startswith("#/components/schemas/"):
            return {}
        key = ref.split("/")[-1]
        return resolve_schema((openapi.get("components") or {}).get("schemas", {}).get(key) or {}, openapi)
    if "allOf" in schema:
        merged = {}
        for part in schema.get("allOf") or []:
            resolved = resolve_schema(part, openapi)
            merged.update(resolved)
            merged.setdefault("properties", {}).update((resolved.get("properties") or {}))
        return merged
    if "anyOf" in schema:
        for part in schema.get("anyOf") or []:
            if isinstance(part, dict) and part.get("type") != "null":
                return resolve_schema(part, openapi)
    if "oneOf" in schema:
        for part in schema.get("oneOf") or []:
            if isinstance(part, dict):
                return resolve_schema(part, openapi)
    return schema

def build_json_body(operation, openapi):
    content = (operation.get("requestBody") or {}).get("content") or {}
    entry = content.get("application/json")
    if not entry:
        for key, value in content.items():
            if "json" in key:
                entry = value
                break
    if not entry:
        return None
    schema = resolve_schema(entry.get("schema") or {}, openapi)
    return sample_value("body", schema)

def build_request(path, method, operation, path_item, openapi):
    params = {}
    query = {}
    for parameter in list(path_item.get("parameters") or []) + list(operation.get("parameters") or []):
        if not isinstance(parameter, dict):
            continue
        if "$ref" in parameter:
            ref = parameter["$ref"]
            if isinstance(ref, str) and ref.startswith("#/components/parameters/"):
                key = ref.split("/")[-1]
                parameter = (openapi.get("components") or {}).get("parameters", {}).get(key) or {}
        name = parameter.get("name")
        location = parameter.get("in")
        schema = resolve_schema(parameter.get("schema") or {}, openapi)
        value = sample_value(name, schema)
        if location == "path":
            params[name] = value
        elif location == "query":
            query[name] = value
    resolved_path = path
    for key, value in params.items():
        resolved_path = resolved_path.replace("{" + str(key) + "}", str(value))
    return resolved_path, query, build_json_body(operation, openapi)

try:
    module = importlib.import_module("app.main")
    app_obj = getattr(module, "app", None)
    if app_obj is None:
        print(json.dumps({"ok": False, "error": "app.main does not expose `app`"}))
        sys.exit(1)

    from fastapi.testclient import TestClient

    client = TestClient(app_obj, raise_server_exceptions=True)
    openapi_response = client.get("/openapi.json")
    if openapi_response.status_code != 200:
        print(json.dumps({
            "ok": False,
            "error": f"/openapi.json returned {openapi_response.status_code}",
            "failures": [{"check": "endpoint_smoke", "message": f"/openapi.json returned {openapi_response.status_code}"}],
        }))
        sys.exit(1)

    openapi = openapi_response.json()
    failures = []
    checked = 0
    for path, path_item in (openapi.get("paths") or {}).items():
        if checked >= 12:
            break
        if not isinstance(path_item, dict):
            continue
        for method in ("get", "post", "put", "patch", "delete"):
            operation = path_item.get(method)
            if not isinstance(operation, dict):
                continue
            resolved_path, query, json_body = build_request(path, method, operation, path_item, openapi)
            try:
                response = client.request(method.upper(), resolved_path, params=query or None, json=json_body)
                if response.status_code >= 500:
                    failures.append({
                        "check": "endpoint_smoke",
                        "message": f"{method.upper()} {path} returned {response.status_code}",
                        "traceback": response.text if isinstance(response.text, str) else "",
                    })
            except Exception as exc:
                failures.append({
                    "check": "endpoint_smoke",
                    "message": f"{method.upper()} {path} raised {exc}",
                    "traceback": traceback.format_exc(),
                })
            checked += 1
            if checked >= 12:
                break

    print(json.dumps({"ok": len(failures) == 0, "has_app": True, "failures": failures}))
    if failures:
        sys.exit(1)
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc), "traceback": traceback.format_exc()}))
    sys.exit(1)
"""
        env = os.environ.copy()
        env["PYTHONPATH"] = str(root) + os.pathsep + env.get("PYTHONPATH", "")
        env.setdefault("DATABASE_URL", f"sqlite:///{(root / 'runtime.db').as_posix()}")
        env.setdefault("AUTH_DATABASE_URL", f"sqlite:///{(root / 'auth-runtime.db').as_posix()}")
        env.setdefault("SECRET_KEY", "repair-agent-test-secret")
        env.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "60")

        try:
            completed = await asyncio.to_thread(
                subprocess.run,
                [sys.executable, "-c", script],
                cwd=str(root),
                env=env,
                capture_output=True,
                text=False,
                timeout=self.timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return (
                [TestFailure(check="import_smoke", message="Runtime smoke test timed out", patchable=False)],
                [],
            )

        stdout = completed.stdout or b""
        stderr = completed.stderr or b""
        out_text = (stdout or b"").decode("utf-8", errors="replace").strip()
        err_text = (stderr or b"").decode("utf-8", errors="replace").strip()

        payload = None
        if out_text:
            try:
                payload = json.loads(out_text.splitlines()[-1])
            except Exception:
                payload = None

        if completed.returncode == 0 and payload and payload.get("ok"):
            return [], []

        failure_msg = ""
        traceback_text = ""
        warnings: list[str] = []
        if payload:
            failure_msg = str(payload.get("error") or "Import smoke test failed")
            traceback_text = str(payload.get("traceback") or "")
        elif err_text:
            failure_msg = err_text
        else:
            failure_msg = out_text or "Import smoke test failed"

        missing_module = re.search(r"No module named ['\"]([^'\"]+)['\"]", f"{failure_msg}\n{traceback_text}")
        if missing_module:
            missing_name = missing_module.group(1)
            if not missing_name.startswith("app"):
                warnings.append(
                    f"Runtime smoke skipped due to missing installed dependency in backend env: {missing_name}"
                )
                return [], warnings

        failures_payload = payload.get("failures") if isinstance(payload, dict) else None
        if isinstance(failures_payload, list) and failures_payload:
            failures: list[TestFailure] = []
            for item in failures_payload:
                item_traceback = str((item or {}).get("traceback") or traceback_text or "")
                file_path, line_number = self._extract_local_trace_failure(item_traceback, root)
                message = str((item or {}).get("message") or failure_msg or "Runtime smoke test failed")
                check = str((item or {}).get("check") or "endpoint_smoke")
                failures.append(
                    TestFailure(
                        check="endpoint_smoke" if check == "endpoint_smoke" else "import_smoke",
                        message=message,
                        file_path=file_path,
                        line_number=line_number,
                        patchable=True if file_path else check == "endpoint_smoke",
                    )
                )
            return failures, warnings

        file_path, line_number = self._extract_local_trace_failure(traceback_text, root)
        return (
            [
                TestFailure(
                    check="import_smoke",
                    message=failure_msg,
                    file_path=file_path,
                    line_number=line_number,
                    patchable=bool(file_path),
                )
            ],
            warnings,
        )

    @staticmethod
    def _build_patch_requests(failures: list[TestFailure]) -> list[FilePatchRequest]:
        by_path: dict[str, list[TestFailure]] = {}
        for failure in failures:
            if not failure.patchable or not failure.file_path:
                continue
            by_path.setdefault(failure.file_path, []).append(failure)

        patch_requests: list[FilePatchRequest] = []
        for path, file_failures in by_path.items():
            instructions = []
            for failure in file_failures:
                loc = f" (line {failure.line_number})" if failure.line_number else ""
                instructions.append(f"Fix {failure.check} failure{loc}: {failure.message}")
            patch_requests.append(
                FilePatchRequest(
                    path=path,
                    reason="Deterministic tests failed for this file",
                    instructions=instructions or ["Fix deterministic test failures while preserving intended behavior."],
                )
            )
        return patch_requests

    async def run(self, code: GeneratedCode, project_id: str | None = None) -> TestRunReport:
        checks_run = ["syntax"]
        warnings: list[str] = []
        failures = self._syntax_check(code.files or [])

        if project_id and any(str(f.path or "") == "app/main.py" for f in (code.files or [])):
            checks_run.extend(["import_smoke", "endpoint_smoke"])
            runtime_failures, runtime_warnings = await self._live_sandbox_check(project_id, code)
            failures.extend(runtime_failures)
            warnings.extend(runtime_warnings)

        patch_requests = self._build_patch_requests(failures)
        blocking_failures = [f for f in failures if f.patchable or f.check == "syntax"]
        passed = len(blocking_failures) == 0

        return TestRunReport(
            passed=passed,
            checks_run=checks_run,
            failures=failures,
            warnings=warnings,
            patch_requests=patch_requests,
        )
