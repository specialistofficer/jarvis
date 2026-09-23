"""
Google Gemini AI Provider implementation using official google-genai SDK.
"""
import json
from typing import Type, TypeVar, Optional, List
from pydantic import BaseModel
from google import genai
from google.genai import types

from src.ai.base import AIProvider
from src.config import settings

T = TypeVar("T", bound=BaseModel)


class GeminiProvider(AIProvider):
    """Production Gemini Provider powered by the official google-genai SDK."""

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self._api_key = api_key or settings.GEMINI_API_KEY
        if not self._api_key:
            raise ValueError("GEMINI_API_KEY must be provided to initialize GeminiProvider")
        self._model = model or settings.GEMINI_MODEL
        self._client = genai.Client(api_key=self._api_key)

    @property
    def name(self) -> str:
        return f"Gemini ({self._model})"

    async def generate(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        temperature: float = 0.7,
        max_output_tokens: Optional[int] = None,
    ) -> str:
        config = types.GenerateContentConfig(
            temperature=temperature,
            system_instruction=system_instruction,
            max_output_tokens=max_output_tokens,
        )
        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=prompt,
            config=config,
        )
        return response.text or ""

    async def structured_output(
        self,
        prompt: str,
        response_model: Type[T],
        system_instruction: Optional[str] = None,
        temperature: float = 0.2,
    ) -> T:
        schema = response_model.model_json_schema()
        augmented_prompt = (
            f"{prompt}\n\n"
            f"You MUST return ONLY a valid JSON object matching this JSON schema:\n"
            f"{json.dumps(schema, indent=2)}\n"
            f"Do not include any Markdown code blocks or markdown fences."
        )

        config = types.GenerateContentConfig(
            temperature=temperature,
            system_instruction=system_instruction,
            response_mime_type="application/json",
        )

        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=augmented_prompt,
            config=config,
        )
        raw_text = response.text or "{}"
        clean_text = raw_text.strip()
        if clean_text.startswith("```json"):
            clean_text = clean_text[7:]
        if clean_text.startswith("```"):
            clean_text = clean_text[3:]
        if clean_text.endswith("```"):
            clean_text = clean_text[:-3]

        data = json.loads(clean_text.strip())
        return response_model.model_validate(data)

    async def classify(
        self,
        text: str,
        categories: List[str],
        system_instruction: Optional[str] = None,
    ) -> str:
        allowed = ", ".join(f'"{c}"' for c in categories)
        prompt = (
            f"Analyze the following text and categorize it into exactly one of these categories: [{allowed}].\n\n"
            f"Text:\n{text}\n\n"
            f"Respond with ONLY the exact category name and nothing else."
        )
        config = types.GenerateContentConfig(temperature=0.0, system_instruction=system_instruction)
        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=prompt,
            config=config,
        )
        predicted = (response.text or "").strip().replace('"', '').replace("'", "")
        # Match case-insensitively with allowed categories
        for cat in categories:
            if cat.lower() == predicted.lower():
                return cat
        return categories[0] if categories else "UNKNOWN"

    async def embed(self, text: str) -> List[float]:
        response = await self._client.aio.models.embed_content(
            model="text-embedding-004",
            contents=text,
        )
        if response.embedding and response.embedding.values:
            return response.embedding.values
        return []
