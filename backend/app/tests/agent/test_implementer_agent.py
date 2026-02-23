import sys
from unittest.mock import AsyncMock, patch, MagicMock
import pytest

from app.agent.implementer_agent import ImplementerAgent
from app.agent.artifacts import SystemArchitecture, GeneratedCode, CodeFile


@pytest.mark.asyncio
async def test_implementer_agent():
    mock_message = MagicMock()
    mock_message.content = """
    {
      "files": [
        {
          "path": "app/models.py",
          "content": "from sqlmodel import SQLModel"
        }
      ],
      "dependencies": ["fastapi", "sqlmodel"]
    }
    """
    
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    
    mock_completions = MagicMock()
    mock_completions.create = AsyncMock(return_value=mock_response)
    
    mock_chat = MagicMock()
    mock_chat.completions = mock_completions
    
    mock_client_instance = AsyncMock()
    mock_client_instance.chat = mock_chat
    
    architecture = SystemArchitecture(
        design_document="",
        db_models=[],
        endpoint_specs=[]
    )
    
    with patch("app.agent.llm_client.AsyncOpenAI", return_value=mock_client_instance):
        with patch("app.agent.llm_client.settings.LLM_API_KEY", "dummy_key"):
            agent = ImplementerAgent()
            
            code = await agent.run(architecture)
            
            assert isinstance(code, GeneratedCode)
            assert len(code.files) == 1
            assert code.files[0].path == "app/models.py"
            assert "fastapi" in code.dependencies
            mock_completions.create.assert_called_once()
