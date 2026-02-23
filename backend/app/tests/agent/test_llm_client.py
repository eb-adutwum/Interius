import sys
from unittest.mock import AsyncMock, patch, MagicMock

import pytest
from pydantic import BaseModel

from app.agent.llm_client import LLMClient


class DummyModel(BaseModel):
    name: str
    age: int


@pytest.mark.asyncio
async def test_llm_client_json_parsing():
    
    # Mock response object mapping the OpenAI API response structure
    mock_message = MagicMock()
    mock_message.content = '{"name": "Alice", "age": 30}'
    
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
    
    with patch("app.agent.llm_client.AsyncOpenAI", return_value=mock_client_instance):
        with patch("app.agent.llm_client.settings.LLM_API_KEY", "dummy_key"):
            client = LLMClient(model_name="test-model")
            
            result = await client.generate_structured(
                system_prompt="You are a helpful assistant.",
                user_prompt="Give me Alice's details",
                response_schema=DummyModel
            )
            
            assert isinstance(result, DummyModel)
            assert result.name == "Alice"
            assert result.age == 30
            mock_completions.create.assert_called_once()
