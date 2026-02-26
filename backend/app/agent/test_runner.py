from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

from app.agent.artifacts import CodeFile, FilePatchRequest, GeneratedCode, TestFailure, TestRunReport


class TestRunner:
    """
    Deterministic post-generation checks.

    Scope (intentional for now):
    - Python syntax compilation of generated files
    - Import/startup smoke check for `app.main`

    No linting, no real endpoint runtime/container execution yet.
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

    @staticmethod
    def _extract_local_trace_failure(traceback_text: str, root: Path) -> tuple[str | None, int | None]:
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

    async def _import_smoke_check(self, root: Path) -> tuple[list[TestFailure], list[str]]:
        script = r"""
import importlib, json, sys, traceback
try:
    module = importlib.import_module("app.main")
    app_obj = getattr(module, "app", None)
    print(json.dumps({"ok": True, "has_app": app_obj is not None}))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc), "traceback": traceback.format_exc()}))
    sys.exit(1)
"""
        env = os.environ.copy()
        env["PYTHONPATH"] = str(root) + os.pathsep + env.get("PYTHONPATH", "")

        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            script,
            cwd=str(root),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=self.timeout_seconds)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return (
                [TestFailure(check="import_smoke", message="Import smoke test timed out", patchable=False)],
                [],
            )

        out_text = (stdout or b"").decode("utf-8", errors="replace").strip()
        err_text = (stderr or b"").decode("utf-8", errors="replace").strip()

        payload = None
        if out_text:
            try:
                payload = json.loads(out_text.splitlines()[-1])
            except Exception:
                payload = None

        if proc.returncode == 0 and payload and payload.get("ok"):
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
                    f"Import smoke skipped due to missing installed dependency in backend env: {missing_name}"
                )
                return [], warnings

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

    async def run(self, code: GeneratedCode) -> TestRunReport:
        checks_run = ["syntax"]
        warnings: list[str] = []
        failures = self._syntax_check(code.files or [])

        with tempfile.TemporaryDirectory(prefix="interius_gen_") as tmpdir:
            root = Path(tmpdir)
            self._write_files(root, code.files or [])
            if any(str(f.path or "") == "app/main.py" for f in (code.files or [])):
                checks_run.append("import_smoke")
                import_failures, import_warnings = await self._import_smoke_check(root)
                failures.extend(import_failures)
                warnings.extend(import_warnings)

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

