import sys
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from app.agent.requirements_agent import RequirementsAgent
from app.agent.artifacts import ProjectCharter


@pytest.mark.asyncio
async def test_requirements_agent():
    
    mock_message = MagicMock()
    mock_message.content = """
    {
      "project_name": "Test Blog API",
      "description": "A simple blog platform.",
      "entities": [
        {
          "name": "Post",
          "fields": [
            {"name": "title", "field_type": "str", "required": true},
            {"name": "content", "field_type": "str", "required": true}
          ]
        }
      ],
      "endpoints": [
        {"method": "GET", "path": "/posts", "description": "List all posts"}
      ],
      "business_rules": ["Posts require a title"],
      "auth_required": false
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
    
    with patch("app.agent.llm_client.AsyncOpenAI", return_value=mock_client_instance):
        with patch("app.agent.llm_client.settings.LLM_API_KEY", "dummy_key"):
            agent = RequirementsAgent()
            
            project_charter = await agent.run("Make a simple blog API")
            
            assert isinstance(project_charter, ProjectCharter)
            assert project_charter.project_name == "Test Blog API"
            assert len(project_charter.entities) == 1
            assert project_charter.entities[0].name == "Post"
            assert len(project_charter.endpoints) == 1
            mock_completions.create.assert_called_once()
