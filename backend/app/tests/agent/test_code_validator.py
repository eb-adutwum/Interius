import unittest

from app.agent.artifacts import CodeFile, GeneratedCode
from app.agent.code_validator import validate_generated_backend


class CodeValidatorTests(unittest.TestCase):
    def test_validator_catches_missing_symbol_and_bad_keywords(self):
        code = GeneratedCode(
            files=[
                CodeFile(
                    path="app/routes.py",
                    content=(
                        "from app import service\n\n"
                        "def handler(session):\n"
                        "    return service.list_todos(session=session, due_date_before=None)\n"
                        "def other(session):\n"
                        "    return service.update_todo(session=session, todo_id=1)\n"
                    ),
                ),
                CodeFile(
                    path="app/service.py",
                    content=(
                        "def list_todos(*, db, due_before=None):\n"
                        "    return []\n\n"
                        "def replace_todo(*, db, todo_id):\n"
                        "    return None\n"
                    ),
                ),
            ],
            dependencies=[],
        )

        report = validate_generated_backend(code)

        self.assertFalse(report.passed)
        messages = [failure.message for failure in report.failures]
        self.assertTrue(
            any(
                "unsupported keyword(s):" in message
                and "session" in message
                and "due_date_before" in message
                for message in messages
            )
        )
        self.assertTrue(any("missing symbol `app.service.update_todo`" in message for message in messages))
        self.assertTrue(any(request.path == "app/routes.py" for request in report.patch_requests))

    def test_validator_catches_sqlmodel_field_runtime_traps(self):
        code = GeneratedCode(
            files=[
                CodeFile(
                    path="app/models.py",
                    content=(
                        "from sqlmodel import SQLModel, Field\n\n"
                        "class Task(SQLModel, table=True):\n"
                        "    id: str = Field(primary_key=True, sa_column='dummy')\n"
                        "    created_at: str = Field(index=True, sa_column='dummy')\n"
                        "    owner_id: str = Field(foreign_key='user.id', sa_column='dummy')\n"
                        "    slug: str = Field(pattern='^[a-z]+$')\n"
                    ),
                ),
            ],
            dependencies=[],
        )

        report = validate_generated_backend(code)

        self.assertFalse(report.passed)
        messages = [failure.message for failure in report.failures]
        self.assertTrue(any("unsupported keyword `pattern`" in message for message in messages))
        self.assertTrue(any("both `primary_key` and `sa_column`" in message for message in messages))
        self.assertTrue(any("both `index` and `sa_column`" in message for message in messages))
        self.assertTrue(any("both `foreign_key` and `sa_column`" in message for message in messages))
        self.assertTrue(any(request.path == "app/models.py" for request in report.patch_requests))

    def test_validator_requires_email_validator_for_emailstr(self):
        code = GeneratedCode(
            files=[
                CodeFile(
                    path="app/schemas.py",
                    content=(
                        "from pydantic import EmailStr\n"
                        "from sqlmodel import SQLModel\n\n"
                        "class LoginRequest(SQLModel):\n"
                        "    username: EmailStr\n"
                    ),
                ),
            ],
            dependencies=[],
        )

        report = validate_generated_backend(code)

        self.assertFalse(report.passed)
        messages = [failure.message for failure in report.failures]
        self.assertTrue(any("uses `EmailStr`" in message for message in messages))
        self.assertTrue(any(request.path == "app/schemas.py" for request in report.patch_requests))

    def test_validator_catches_missing_module_attribute_reference(self):
        code = GeneratedCode(
            files=[
                CodeFile(
                    path="app/routes.py",
                    content=(
                        "from app import schemas\n\n"
                        "def login():\n"
                        "    return schemas.TokenResponse\n"
                    ),
                ),
                CodeFile(
                    path="app/schemas.py",
                    content=(
                        "class Token:\n"
                        "    pass\n"
                    ),
                ),
            ],
            dependencies=[],
        )

        report = validate_generated_backend(code)

        self.assertFalse(report.passed)
        messages = [failure.message for failure in report.failures]
        self.assertTrue(any("missing symbol `app.schemas.TokenResponse`" in message for message in messages))
        self.assertTrue(any(request.path == "app/routes.py" for request in report.patch_requests))

    def test_validator_catches_duplicate_router_prefixes_and_scalar_one(self):
        code = GeneratedCode(
            files=[
                CodeFile(
                    path="app/main.py",
                    content=(
                        "from fastapi import FastAPI\n"
                        "from app.routes import router as todos_router\n\n"
                        "app = FastAPI()\n"
                        "app.include_router(todos_router, prefix='/todos')\n"
                    ),
                ),
                CodeFile(
                    path="app/routes.py",
                    content=(
                        "from fastapi import APIRouter\n\n"
                        "router = APIRouter(prefix='/todos')\n\n"
                        "def list_todos(session, stmt):\n"
                        "    return session.exec(stmt).scalar_one()\n"
                    ),
                ),
            ],
            dependencies=[],
        )

        report = validate_generated_backend(code)

        self.assertFalse(report.passed)
        messages = [failure.message for failure in report.failures]
        self.assertTrue(any("Router prefix is duplicated" in message for message in messages))
        self.assertTrue(any("scalar_one()" in message for message in messages))
        self.assertTrue(any(request.path == "app/main.py" for request in report.patch_requests))
        self.assertTrue(any(request.path == "app/routes.py" for request in report.patch_requests))

    def test_validator_catches_field_name_type_annotation_collision(self):
        code = GeneratedCode(
            files=[
                CodeFile(
                    path="app/models.py",
                    content=(
                        "from datetime import date\n"
                        "from sqlmodel import SQLModel, Field\n\n"
                        "class Expense(SQLModel, table=True):\n"
                        "    date: date = Field(default_factory=date.today)\n"
                    ),
                ),
            ],
            dependencies=[],
        )

        report = validate_generated_backend(code)

        self.assertFalse(report.passed)
        messages = [failure.message for failure in report.failures]
        self.assertTrue(any("clashes with its type annotation" in message for message in messages))
        self.assertTrue(any(request.path == "app/models.py" for request in report.patch_requests))

    def test_validator_catches_duplicate_field_index_and_duplicate_create_all(self):
        code = GeneratedCode(
            files=[
                CodeFile(
                    path="app/main.py",
                    content=(
                        "from sqlmodel import SQLModel\n"
                        "from app.database import engine\n\n"
                        "def on_startup():\n"
                        "    SQLModel.metadata.create_all(engine)\n"
                    ),
                ),
                CodeFile(
                    path="app/database.py",
                    content=(
                        "from sqlmodel import SQLModel\n\n"
                        "def init_db(engine):\n"
                        "    SQLModel.metadata.create_all(engine)\n"
                    ),
                ),
                CodeFile(
                    path="app/models.py",
                    content=(
                        "from sqlalchemy import Index\n"
                        "from sqlmodel import SQLModel, Field\n\n"
                        "class User(SQLModel, table=True):\n"
                        "    __table_args__ = (Index('ix_users_email', 'email', unique=True),)\n"
                        "    email: str = Field(index=True)\n"
                    ),
                ),
            ],
            dependencies=[],
        )

        report = validate_generated_backend(code)

        self.assertFalse(report.passed)
        messages = [failure.message for failure in report.failures]
        self.assertTrue(any("Field `email` declares `index=True`" in message for message in messages))
        self.assertTrue(any("Schema initialization runs in both `app.database` and `app.main`" in message for message in messages))
        self.assertTrue(any(request.path == "app/main.py" for request in report.patch_requests))
        self.assertTrue(any(request.path == "app/models.py" for request in report.patch_requests))


if __name__ == "__main__":
    unittest.main()
