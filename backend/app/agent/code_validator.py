from __future__ import annotations

import ast
from dataclasses import dataclass

from app.agent.artifacts import (
    FilePatchRequest,
    GeneratedCode,
    TestFailure,
    TestRunReport,
)


@dataclass
class FunctionSignature:
    path: str
    name: str
    keyword_params: set[str]
    accepts_var_keyword: bool


@dataclass
class ModuleInfo:
    path: str
    exports: set[str]
    functions: dict[str, FunctionSignature]
    router_prefixes: dict[str, str]
    has_create_all: bool
    explicit_indexed_fields: set[str]


def _annotation_contains_name(node: ast.AST | None, target_name: str) -> bool:
    if node is None:
        return False
    for child in ast.walk(node):
        if isinstance(child, ast.Name) and child.id == target_name:
            return True
    return False


def _module_name_from_path(path: str) -> str | None:
    normalized = (path or "").replace("\\", "/").strip().lstrip("/")
    if not normalized.endswith(".py"):
        return None
    module_path = normalized[:-3]
    if module_path.endswith("/__init__"):
        module_path = module_path[: -len("/__init__")]
    return module_path.replace("/", ".")


def _build_module_infos(code: GeneratedCode) -> tuple[dict[str, ModuleInfo], list[TestFailure]]:
    modules: dict[str, ModuleInfo] = {}
    failures: list[TestFailure] = []

    for code_file in code.files:
        if not code_file.path.endswith(".py"):
            continue
        module_name = _module_name_from_path(code_file.path)
        if not module_name:
            continue
        try:
            tree = ast.parse(code_file.content, filename=code_file.path)
        except SyntaxError as exc:
            failures.append(
                TestFailure(
                    check="syntax",
                    message=f"Syntax error: {exc.msg}",
                    file_path=code_file.path,
                    line_number=exc.lineno,
                )
            )
            continue

        exports: set[str] = set()
        functions: dict[str, FunctionSignature] = {}
        router_prefixes: dict[str, str] = {}
        has_create_all = False
        explicit_indexed_fields: set[str] = set()
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                exports.add(node.name)
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        exports.add(target.id)
                        if isinstance(node.value, ast.Call):
                            func = node.value.func
                            is_api_router = (
                                isinstance(func, ast.Name) and func.id == "APIRouter"
                            ) or (
                                isinstance(func, ast.Attribute) and func.attr == "APIRouter"
                            )
                            if is_api_router:
                                for keyword in node.value.keywords:
                                    if keyword.arg == "prefix" and isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str):
                                        router_prefixes[target.id] = keyword.value.value
                                        break
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                exports.add(node.target.id)
                if _annotation_contains_name(node.annotation, node.target.id):
                    failures.append(
                        TestFailure(
                            check="import_smoke",
                            message=(
                                f"Field name `{node.target.id}` clashes with its type annotation. "
                                "Alias imported datetime-like types (for example `date as date_type`) "
                                "or rename the field to avoid Pydantic startup failures."
                            ),
                            file_path=code_file.path,
                            line_number=node.lineno,
                        )
                    )

            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                keyword_params = {
                    arg.arg
                    for arg in (
                        list(node.args.posonlyargs)
                        + list(node.args.args)
                        + list(node.args.kwonlyargs)
                    )
                }
                if node.args.vararg:
                    keyword_params.add(node.args.vararg.arg)
                functions[node.name] = FunctionSignature(
                    path=code_file.path,
                    name=node.name,
                    keyword_params=keyword_params,
                    accepts_var_keyword=node.args.kwarg is not None,
                )

        for child in ast.walk(tree):
            if (
                isinstance(child, ast.Call)
                and isinstance(child.func, ast.Attribute)
                and isinstance(child.func.value, ast.Attribute)
                and isinstance(child.func.value.value, ast.Name)
                and child.func.value.value.id == "SQLModel"
                and child.func.value.attr == "metadata"
                and child.func.attr == "create_all"
            ):
                has_create_all = True
            if isinstance(child, ast.Call) and isinstance(child.func, ast.Name) and child.func.id == "Index":
                for arg in child.args[1:]:
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        explicit_indexed_fields.add(arg.value)

        modules[module_name] = ModuleInfo(
            path=code_file.path,
            exports=exports,
            functions=functions,
            router_prefixes=router_prefixes,
            has_create_all=has_create_all,
            explicit_indexed_fields=explicit_indexed_fields,
        )

    return modules, failures


def _resolve_local_module(base_module: str, imported_name: str, modules: dict[str, ModuleInfo]) -> str | None:
    candidate = f"{base_module}.{imported_name}"
    if candidate in modules:
        return candidate
    return None


def _validator_patch_requests(failures: list[TestFailure]) -> list[FilePatchRequest]:
    by_path: dict[str, list[str]] = {}
    for failure in failures:
        path = (failure.file_path or "").strip()
        if not path:
            continue
        by_path.setdefault(path, []).append(failure.message)

    return [
        FilePatchRequest(
            path=path,
            reason="Deterministic validator found unresolved imports or incompatible function contracts",
            instructions=messages,
        )
        for path, messages in by_path.items()
    ]


def validate_generated_backend(code: GeneratedCode) -> TestRunReport:
    modules, failures = _build_module_infos(code)
    dependency_names = {str(dep).strip() for dep in (code.dependencies or []) if str(dep).strip()}

    for code_file in code.files:
        if not code_file.path.endswith(".py"):
            continue
        module_name = _module_name_from_path(code_file.path)
        if not module_name or module_name not in modules:
            continue

        tree = ast.parse(code_file.content, filename=code_file.path)
        for parent in ast.walk(tree):
            for child in ast.iter_child_nodes(parent):
                setattr(child, "parent", parent)
        module_aliases: dict[str, str] = {}
        direct_imports: dict[str, tuple[str, str]] = {}
        sqlmodel_field_symbols: set[str] = set()
        sqlmodel_module_aliases: set[str] = set()

        for node in tree.body:
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == "sqlmodel":
                        sqlmodel_module_aliases.add(alias.asname or alias.name)
                    if not alias.name.startswith("app."):
                        continue
                    if alias.name in modules:
                        module_aliases[alias.asname or alias.name.rsplit(".", 1)[-1]] = alias.name
            elif isinstance(node, ast.ImportFrom):
                if node.module == "sqlmodel":
                    for alias in node.names:
                        if alias.name == "Field":
                            sqlmodel_field_symbols.add(alias.asname or alias.name)
                if not node.module or not node.module.startswith("app"):
                    continue

                if node.module in modules:
                    target_module = node.module
                    for alias in node.names:
                        if alias.name == "*":
                            continue
                        module_info = modules.get(target_module)
                        if module_info and alias.name not in module_info.exports:
                            failures.append(
                                TestFailure(
                                    check="import_smoke",
                                    message=f"Imported symbol `{alias.name}` does not exist in `{target_module}`.",
                                    file_path=code_file.path,
                                    line_number=node.lineno,
                                )
                            )
                        direct_imports[alias.asname or alias.name] = (target_module, alias.name)
                else:
                    for alias in node.names:
                        if alias.name == "*":
                            continue
                        child_module = _resolve_local_module(node.module, alias.name, modules)
                        if child_module:
                            module_aliases[alias.asname or alias.name] = child_module

        for node in tree.body:
            if isinstance(node, ast.ClassDef):
                is_table = False
                for kw in node.keywords:
                    if kw.arg == "table" and isinstance(kw.value, ast.Constant) and getattr(kw.value, "value", None) is True:
                        is_table = True
                        break
                
                if is_table:
                    has_primary_key = False
                    for class_node in node.body:
                        if isinstance(class_node, ast.AnnAssign) and isinstance(class_node.value, ast.Call):
                            call = class_node.value
                            is_field = False
                            if isinstance(call.func, ast.Name) and call.func.id in sqlmodel_field_symbols:
                                is_field = True
                            elif isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name) and call.func.value.id in sqlmodel_module_aliases and call.func.attr == "Field":
                                is_field = True
                            
                            if is_field:
                                for field_kw in call.keywords:
                                    if field_kw.arg == "primary_key" and isinstance(field_kw.value, ast.Constant) and getattr(field_kw.value, "value", None) is True:
                                        has_primary_key = True
                                        break
                    
                    if not has_primary_key:
                        failures.append(
                            TestFailure(
                                check="import_smoke",
                                message=(
                                    f"SQLModel table `{node.name}` is missing a primary key. "
                                    "Add `primary_key=True` to at least one `Field(...)`."
                                ),
                                file_path=code_file.path,
                                line_number=node.lineno,
                            )
                        )

        for child in ast.walk(tree):
            if isinstance(child, ast.AnnAssign) and isinstance(child.target, ast.Name):
                if _annotation_contains_name(child.annotation, child.target.id):
                    failures.append(
                        TestFailure(
                            check="import_smoke",
                            message=(
                                f"Field name `{child.target.id}` clashes with its type annotation. "
                                "Alias imported datetime-like types (for example `date as date_type`) "
                                "or rename the field to avoid Pydantic startup failures."
                            ),
                            file_path=code_file.path,
                            line_number=child.lineno,
                        )
                    )

            if (
                isinstance(child, ast.Attribute)
                and isinstance(child.value, ast.Name)
                and child.value.id in module_aliases
                and not isinstance(child.ctx, ast.Store)
            ):
                target_module_name = module_aliases.get(child.value.id)
                module_info = modules.get(target_module_name or "")
                if module_info and child.attr not in module_info.exports:
                    failures.append(
                        TestFailure(
                            check="import_smoke",
                            message=f"Attribute reference uses missing symbol `{target_module_name}.{child.attr}`.",
                            file_path=code_file.path,
                            line_number=child.lineno,
                        )
                    )

            if not isinstance(child, ast.Call):
                continue

            if isinstance(child.func, ast.Attribute) and child.func.attr == "include_router":
                include_prefix = next(
                    (
                        keyword.value.value
                        for keyword in child.keywords
                        if keyword.arg == "prefix"
                        and isinstance(keyword.value, ast.Constant)
                        and isinstance(keyword.value.value, str)
                    ),
                    None,
                )
                router_prefix = None
                if child.args:
                    router_arg = child.args[0]
                    if isinstance(router_arg, ast.Attribute) and isinstance(router_arg.value, ast.Name):
                        target_module_name = module_aliases.get(router_arg.value.id)
                        module_info = modules.get(target_module_name or "")
                        if module_info:
                            router_prefix = module_info.router_prefixes.get(router_arg.attr)
                    elif isinstance(router_arg, ast.Name):
                        direct_ref = direct_imports.get(router_arg.id)
                        if direct_ref:
                            target_module_name, symbol_name = direct_ref
                            module_info = modules.get(target_module_name or "")
                            if module_info:
                                router_prefix = module_info.router_prefixes.get(symbol_name)
                if include_prefix and router_prefix and include_prefix == router_prefix and include_prefix != "/":
                    failures.append(
                        TestFailure(
                            check="import_smoke",
                            message=(
                                f"Router prefix is duplicated: `{router_prefix}` is declared both in the router and in `include_router(...)`. "
                                "Keep the prefix in exactly one place."
                            ),
                            file_path=code_file.path,
                            line_number=child.lineno,
                        )
                    )

            if isinstance(child.func, ast.Attribute) and child.func.attr == "scalar_one":
                exec_call = child.func.value
                if (
                    isinstance(exec_call, ast.Call)
                    and isinstance(exec_call.func, ast.Attribute)
                    and exec_call.func.attr == "exec"
                ):
                    failures.append(
                        TestFailure(
                            check="import_smoke",
                            message=(
                                "SQLModel result handling uses `session.exec(...).scalar_one()`, which is incompatible with the sandbox runtime. "
                                "Use a supported pattern such as `.one()`, `.first()`, or `.one_or_none()` depending on intent."
                            ),
                            file_path=code_file.path,
                            line_number=child.lineno,
                        )
                    )

            if isinstance(child, ast.Subscript):
                if isinstance(child.value, ast.Call) and isinstance(child.value.func, ast.Attribute) and child.value.func.attr in ("one", "first"):
                    exec_call = child.value.func.value
                    if isinstance(exec_call, ast.Call) and isinstance(exec_call.func, ast.Attribute) and exec_call.func.attr == "exec":
                        failures.append(
                            TestFailure(
                                check="import_smoke",
                                message=(
                                    "Calling `.one()[0]` or `.first()[0]` on `session.exec(...)` result throws a TypeError "
                                    "when selecting single scalar columns like `func.count()`. Omit the `[0]` subscript."
                                ),
                                file_path=code_file.path,
                                line_number=child.lineno,
                            )
                        )

            is_sqlmodel_field_call = (
                isinstance(child.func, ast.Name) and child.func.id in sqlmodel_field_symbols
            ) or (
                isinstance(child.func, ast.Attribute)
                and isinstance(child.func.value, ast.Name)
                and child.func.value.id in sqlmodel_module_aliases
                and child.func.attr == "Field"
            )
            if is_sqlmodel_field_call:
                seen_args = set()
                for kw in child.keywords:
                    if kw.arg is not None:
                        if kw.arg in seen_args:
                            failures.append(
                                TestFailure(
                                    check="import_smoke",
                                    message=f"SQLModel Field declares keyword argument `{kw.arg}` multiple times. A keyword argument cannot be repeated.",
                                    file_path=code_file.path,
                                    line_number=child.lineno,
                                )
                            )
                        seen_args.add(kw.arg)

                keyword_names = seen_args
                if "pattern" in keyword_names:
                    failures.append(
                        TestFailure(
                            check="import_smoke",
                            message="SQLModel Field uses unsupported keyword `pattern`; use `regex` instead.",
                            file_path=code_file.path,
                            line_number=child.lineno,
                        )
                    )
                if "primary_key" in keyword_names and "sa_column" in keyword_names:
                    failures.append(
                        TestFailure(
                            check="import_smoke",
                            message="SQLModel Field cannot declare both `primary_key` and `sa_column`; move `primary_key=True` into the SQLAlchemy Column.",
                            file_path=code_file.path,
                            line_number=child.lineno,
                        )
                    )
                if "index" in keyword_names and "sa_column" in keyword_names:
                    failures.append(
                        TestFailure(
                            check="import_smoke",
                            message="SQLModel Field cannot declare both `index` and `sa_column`; move `index=True` into the SQLAlchemy Column.",
                            file_path=code_file.path,
                            line_number=child.lineno,
                        )
                    )
                if "foreign_key" in keyword_names and "sa_column" in keyword_names:
                    failures.append(
                        TestFailure(
                            check="import_smoke",
                            message="SQLModel Field cannot declare both `foreign_key` and `sa_column`; move the foreign key constraint into the SQLAlchemy Column with `ForeignKey(...)`.",
                            file_path=code_file.path,
                            line_number=child.lineno,
                        )
                    )
                if "index" in keyword_names:
                    field_name = None
                    parent = getattr(child, "parent", None)
                    if isinstance(parent, ast.AnnAssign) and isinstance(parent.target, ast.Name):
                        field_name = parent.target.id
                    if field_name and field_name in modules[module_name].explicit_indexed_fields:
                        failures.append(
                            TestFailure(
                                check="import_smoke",
                                message=(
                                    f"Field `{field_name}` declares `index=True` and also has an explicit SQLAlchemy `Index(...)` declaration. "
                                    "Keep the index in exactly one place to avoid duplicate index creation at startup."
                                ),
                                file_path=code_file.path,
                                line_number=child.lineno,
                            )
                        )

            target_module_name: str | None = None
            target_function_name: str | None = None

            if isinstance(child.func, ast.Attribute) and isinstance(child.func.value, ast.Name):
                target_module_name = module_aliases.get(child.func.value.id)
                target_function_name = child.func.attr
            elif isinstance(child.func, ast.Name):
                direct_ref = direct_imports.get(child.func.id)
                if direct_ref:
                    target_module_name, target_function_name = direct_ref

            if not target_module_name or not target_function_name:
                continue

            module_info = modules.get(target_module_name)
            if not module_info:
                continue

            signature = module_info.functions.get(target_function_name)
            if not signature:
                if target_function_name not in module_info.exports:
                    failures.append(
                        TestFailure(
                            check="import_smoke",
                            message=f"Call references missing symbol `{target_module_name}.{target_function_name}`.",
                            file_path=code_file.path,
                            line_number=child.lineno,
                        )
                    )
                continue

            if signature.accepts_var_keyword:
                continue

            invalid_keywords = sorted(
                {
                    kw.arg
                    for kw in child.keywords
                    if kw.arg is not None and kw.arg not in signature.keyword_params
                }
            )
            if invalid_keywords:
                failures.append(
                    TestFailure(
                        check="import_smoke",
                        message=(
                            f"Call to `{target_module_name}.{target_function_name}` uses unsupported keyword(s): "
                            + ", ".join(invalid_keywords)
                        ),
                        file_path=code_file.path,
                        line_number=child.lineno,
                    )
                )

        uses_email_str = any(
            isinstance(node, ast.Name) and node.id == "EmailStr"
            for node in ast.walk(tree)
        )
        if uses_email_str:
            has_email_dependency = any(
                dep == "email-validator" or dep.startswith("pydantic[email]")
                for dep in dependency_names
            )
            if not has_email_dependency:
                failures.append(
                    TestFailure(
                        check="import_smoke",
                        message="Generated code uses `EmailStr` but dependencies do not include `email-validator` or `pydantic[email]`.",
                        file_path=code_file.path,
                        line_number=1,
                    )
                )

    database_module = modules.get("app.database")
    main_module = modules.get("app.main")
    if database_module and main_module and database_module.has_create_all and main_module.has_create_all:
        failures.append(
            TestFailure(
                check="import_smoke",
                message=(
                    "Schema initialization runs in both `app.database` and `app.main` via `SQLModel.metadata.create_all(...)`. "
                    "Keep startup schema creation in exactly one place to avoid duplicate index/table creation on boot."
                ),
                file_path=main_module.path,
                line_number=1,
            )
        )

    deduped: list[TestFailure] = []
    seen: set[tuple[str, str, int | None]] = set()
    for failure in failures:
        key = (failure.file_path or "", failure.message, failure.line_number)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(failure)

    return TestRunReport(
        passed=not deduped,
        checks_run=["syntax", "import_smoke"],
        failures=deduped,
        warnings=[],
        patch_requests=_validator_patch_requests(deduped),
    )
