import sys
from unittest.mock import AsyncMock, patch, MagicMock
import pytest

from app.agent.reviewer_agent import ReviewerAgent
from app.agent.artifacts import GeneratedCode, ReviewReport, CodeFile, Issue


@pytest.mark.asyncio
async def test_reviewer_agent():
    mock_message = MagicMock()
    mock_message.content = """
    {
      "issues": [
        {
          "severity": "low",
          "description": "Missing docstrings",
          "file_path": "app/models.py",
          "line_number": 1
        }
      ],
      "suggestions": ["Add more comments"],
      "security_score": 9,
      "approved": true,
      "final_code": [
        {
          "path": "app/models.py",
          "content": "from sqlmodel import SQLModel\\n\\n# Fixed model"
        }
      ]
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
    
    generated_code = GeneratedCode(
        files=[CodeFile(path="app/models.py", content="from sqlmodel import SQLModel")],
        dependencies=[]
    )
    
    with patch("app.agent.llm_client.AsyncOpenAI", return_value=mock_client_instance):
        with patch("app.agent.llm_client.settings.LLM_API_KEY", "dummy_key"):
            agent = ReviewerAgent()
            
            report = await agent.run(generated_code)
            
            assert isinstance(report, ReviewReport)
            assert report.approved is True
            assert report.security_score == 9
            assert len(report.final_code) == 1
            assert "Fixed model" in report.final_code[0].content
            mock_completions.create.assert_called_once()
