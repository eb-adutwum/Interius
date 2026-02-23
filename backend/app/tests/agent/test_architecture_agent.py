import sys
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from app.agent.architecture_agent import ArchitectureAgent
from app.agent.artifacts import ProjectCharter, SystemArchitecture, Entity, EntityField, Endpoint


@pytest.mark.asyncio
async def test_architecture_agent():
    
    # Mock response object mapping the OpenAI API response structure
    mock_message = MagicMock()
    mock_message.content = """
    {
      "design_document": "# Architecture\\nThis is a generic design doc.",
      "db_models": [
        {
          "table_name": "User",
          "columns": [{"name": "id", "type": "uuid.UUID"}],
          "relationships": []
        }
      ],
      "endpoint_specs": [
        {
          "method": "GET",
          "path": "/users",
          "description": "Get all users",
          "request_schema": null,
          "response_schema": "list[User]"
        }
      ]
    }
    """
    
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    
    # Mock the AsyncOpenAI client
    mock_completions = MagicMock()
    mock_completions.create = AsyncMock(return_value=mock_response)
    
    mock_chat = MagicMock()
    mock_chat.completions = mock_completions
    
    mock_client_instance = AsyncMock()
    mock_client_instance.chat = mock_chat
    
    charter = ProjectCharter(
        project_name="Blog API",
        description="A blog",
        entities=[],
        endpoints=[],
        business_rules=[],
        auth_required=False
    )
    
    with patch("app.agent.llm_client.AsyncOpenAI", return_value=mock_client_instance):
        with patch("app.agent.llm_client.settings.LLM_API_KEY", "dummy_key"):
            agent = ArchitectureAgent()
            
            architecture = await agent.run(charter)
            
            assert isinstance(architecture, SystemArchitecture)
            assert "Architecture" in architecture.design_document
            assert len(architecture.db_models) == 1
            assert architecture.db_models[0].table_name == "User"
            assert len(architecture.endpoint_specs) == 1
            mock_completions.create.assert_called_once()
