from __future__ import annotations

from typing import Any

from campus_evals.settings import RagasSettings


def build_responses_compatible_chat_openai(**kwargs: Any):
    """Compat wrapper for ragas + LangChain Responses API calls."""
    from langchain_openai import ChatOpenAI

    class _PatchedChatOpenAI(ChatOpenAI):
        def _get_request_payload(self, input_, *, stop=None, **request_kwargs):  # type: ignore[override]
            payload = super()._get_request_payload(input_, stop=stop, **request_kwargs)
            if self._use_responses_api(payload):
                payload.pop("n", None)
            return payload

    return _PatchedChatOpenAI(**kwargs)


def build_langchain_chat_model(settings: RagasSettings):
    return build_responses_compatible_chat_openai(
        model=settings.llm_model,
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        timeout=settings.request_timeout_seconds,
        temperature=0,
        use_responses_api=settings.use_responses_api,
    )


def build_langchain_embeddings(settings: RagasSettings):
    from langchain_openai import OpenAIEmbeddings

    kwargs = {
        "model": settings.embedding_model,
        "api_key": settings.embedding_api_key,
        "base_url": settings.embedding_base_url,
        "timeout": settings.request_timeout_seconds,
    }
    if settings.embedding_dimensions is not None:
        kwargs["dimensions"] = settings.embedding_dimensions
    return OpenAIEmbeddings(**kwargs)
