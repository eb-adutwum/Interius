import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.api.routes.sandbox import (
    _dedupe_router_prefixes,
    _dedupe_sandbox_schema_bootstrap,
    _normalize_sandbox_source,
    _openapi_looks_like_fallback,
    _remove_duplicate_field_indexes,
)


class SandboxNormalizerTests(unittest.TestCase):
    def test_normalizer_does_not_duplicate_field_blocks_with_sa_column(self):
        source = (
            "from sqlmodel import SQLModel, Field, Column\n"
            "from sqlalchemy import Text\n\n"
            "class Todo(SQLModel, table=True):\n"
            "    description: str | None = Field(\n"
            "        default=None,\n"
            "        sa_column=Column(Text, nullable=True),\n"
            "    )\n"
        )

        normalized = _normalize_sandbox_source("app/models.py", source)

        self.assertEqual(normalized.count("description: str | None = Field("), 1)
        self.assertEqual(normalized.count("sa_column=Column(Text, nullable=True)"), 1)

    def test_normalizer_aliases_datetime_imports_when_field_name_matches_type(self):
        source = (
            "from datetime import datetime, date\n"
            "from sqlmodel import SQLModel, Field\n\n"
            "class Expense(SQLModel, table=True):\n"
            "    date: date = Field(default_factory=date.today)\n"
            "    created_at: datetime = Field(default_factory=datetime.utcnow)\n"
        )

        normalized = _normalize_sandbox_source("app/models.py", source)

        self.assertIn("from datetime import datetime, date as date_type", normalized)
        self.assertIn("date: date_type = Field(default_factory=date_type.today)", normalized)
        self.assertIn("created_at: datetime = Field(default_factory=datetime.utcnow)", normalized)

    def test_normalizer_adds_auth_compatibility_aliases(self):
        source = (
            "def hash_password(password: str) -> str:\n"
            "    return password\n\n"
            "def create_access_token(*, subject: str, expires_delta=None):\n"
            "    return subject\n\n"
            "def get_current_user():\n"
            "    return None\n"
        )

        normalized = _normalize_sandbox_source("app/auth.py", source)

        self.assertIn("get_password_hash = hash_password", normalized)
        self.assertIn("current_user = get_current_user", normalized)
        self.assertIn("def _sandbox_create_access_token_impl(*, subject: str, expires_delta=None):", normalized)
        self.assertIn("def create_access_token(subject=None, expires_delta=None):", normalized)

    def test_normalizer_removes_duplicate_field_index_when_explicit_index_exists(self):
        source = (
            "from sqlalchemy import Index\n"
            "from sqlmodel import SQLModel, Field\n\n"
            "class User(SQLModel, table=True):\n"
            "    __table_args__ = (Index('ix_users_email', 'email', unique=True),)\n"
            "    email: str = Field(default='', index=True)\n"
        )

        normalized = _remove_duplicate_field_indexes(source)

        self.assertIn("Index('ix_users_email', 'email', unique=True)", normalized)
        self.assertIn("email: str = Field(default='')", normalized)
        self.assertNotIn("index=True", normalized)

    def test_normalizer_dedupes_main_startup_create_all_when_database_bootstraps(self):
        with TemporaryDirectory() as tmpdir:
            sandbox_dir = Path(tmpdir)
            app_dir = sandbox_dir / "app"
            app_dir.mkdir(parents=True, exist_ok=True)
            (app_dir / "database.py").write_text(
                "from sqlmodel import SQLModel\n"
                "def init_db(engine):\n"
                "    SQLModel.metadata.create_all(engine)\n",
                encoding="utf-8",
            )
            (app_dir / "main.py").write_text(
                "from sqlmodel import SQLModel\n"
                "from app.database import engine\n\n"
                "def on_startup():\n"
                "    SQLModel.metadata.create_all(engine)\n",
                encoding="utf-8",
            )

            _dedupe_sandbox_schema_bootstrap(sandbox_dir)

            main_source = (app_dir / "main.py").read_text(encoding="utf-8")
            self.assertNotIn("SQLModel.metadata.create_all(engine)", main_source)

    def test_normalizer_dedupes_include_router_prefix_when_router_declares_same_prefix(self):
        with TemporaryDirectory() as tmpdir:
            sandbox_dir = Path(tmpdir)
            app_dir = sandbox_dir / "app"
            app_dir.mkdir(parents=True, exist_ok=True)
            (app_dir / "routes.py").write_text(
                'from fastapi import APIRouter\n'
                'auth_router = APIRouter(prefix="/auth")\n'
                'expenses_router = APIRouter(prefix="/expenses")\n',
                encoding="utf-8",
            )
            (app_dir / "main.py").write_text(
                'from fastapi import FastAPI\n'
                'from app.routes import auth_router, expenses_router\n'
                'app = FastAPI()\n'
                'app.include_router(auth_router, prefix="/auth", tags=["auth"])\n'
                'app.include_router(expenses_router, prefix="/expenses", tags=["expenses"])\n',
                encoding="utf-8",
            )

            _dedupe_router_prefixes(sandbox_dir)

            main_source = (app_dir / "main.py").read_text(encoding="utf-8")
            self.assertIn('app.include_router(auth_router, tags=["auth"])', main_source)
            self.assertIn('app.include_router(expenses_router, tags=["expenses"])', main_source)
            self.assertNotIn('prefix="/auth"', main_source)
            self.assertNotIn('prefix="/expenses"', main_source)

    def test_normalizer_moves_foreign_key_into_sa_column(self):
        source = (
            "from sqlalchemy import Column\n"
            "from sqlalchemy.dialects.postgresql import UUID as PG_UUID\n"
            "from sqlmodel import SQLModel, Field\n\n"
            "class Note(SQLModel, table=True):\n"
            "    owner_id: str = Field(\n"
            "        foreign_key='user.id',\n"
            "        sa_column=Column(PG_UUID(as_uuid=True), nullable=False),\n"
            "    )\n"
        )

        normalized = _normalize_sandbox_source("app/models.py", source)

        self.assertIn("from sqlalchemy import Column, ForeignKey", normalized)
        self.assertIn("sa_column=Column(PG_UUID(as_uuid=True), ForeignKey('user.id'), nullable=False)", normalized)
        self.assertNotIn("foreign_key='user.id'", normalized)

    def test_normalizer_moves_foreign_key_into_inline_sa_column(self):
        source = (
            "from sqlalchemy import Column\n"
            "from sqlalchemy.dialects.postgresql import UUID as PG_UUID\n"
            "from sqlmodel import SQLModel, Field\n\n"
            "class Note(SQLModel, table=True):\n"
            "    owner_id: str = Field(foreign_key='user.id', sa_column=Column(PG_UUID(as_uuid=True), nullable=False))\n"
        )

        normalized = _normalize_sandbox_source("app/models.py", source)

        self.assertIn("from sqlalchemy import Column, ForeignKey", normalized)
        self.assertIn("owner_id: str = Field(sa_column=Column(PG_UUID(as_uuid=True), ForeignKey('user.id'), nullable=False))", normalized)
        self.assertNotIn("foreign_key='user.id'", normalized)

    def test_fallback_openapi_detection_flags_shell_apps(self):
        self.assertTrue(_openapi_looks_like_fallback({"paths": {"/": {"get": {}}}}))
        self.assertTrue(_openapi_looks_like_fallback({"paths": {"/health": {"get": {}}, "/ready": {"get": {}}}}))
        self.assertFalse(_openapi_looks_like_fallback({"paths": {"/notes": {"get": {}}, "/auth/login": {"post": {}}}}))

    def test_normalizer_exports_api_router_when_generated_routes_only_expose_router_list(self):
        source = (
            "from fastapi import APIRouter\n\n"
            "auth_router = APIRouter(prefix='/auth')\n"
            "expenses_router = APIRouter(prefix='/expenses')\n"
            "router_list = [auth_router, expenses_router]\n"
        )

        normalized = _normalize_sandbox_source("app/routes.py", source)

        self.assertIn("api_router = APIRouter()", normalized)
        self.assertIn("for _router in router_list:", normalized)
        self.assertIn("def get_router():", normalized)
        self.assertIn("return api_router", normalized)


if __name__ == "__main__":
    unittest.main()
