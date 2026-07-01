from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from campus_ingestion_core.tokenizer_cache import resolve_prefetched_hf_tokenizer_path


def count_tokens_with_local_tokenizer(*, repo_id: str, text: str) -> int:
    tokenizer = _load_local_tokenizer(repo_id)
    return len(tokenizer.encode(text, add_special_tokens=False).ids)


@lru_cache(maxsize=4)
def _load_local_tokenizer(repo_id: str) -> Any:
    try:
        from tokenizers import Tokenizer
    except ImportError:
        raise RuntimeError("tokenizers is required for local Hugging Face token counting") from None
    tokenizer_json_path = _resolve_tokenizer_json_path(repo_id)
    return Tokenizer.from_file(str(tokenizer_json_path))


def _resolve_tokenizer_json_path(repo_id: str) -> Path:
    snapshot_path = Path(resolve_prefetched_hf_tokenizer_path(repo_id))
    tokenizer_json_path = snapshot_path / "tokenizer.json"
    if not tokenizer_json_path.is_file():
        raise RuntimeError(f"Tokenizer snapshot for {repo_id} is missing tokenizer.json")
    return tokenizer_json_path


count_tokens_with_local_tokenizer.cache_clear = _load_local_tokenizer.cache_clear


__all__ = ["count_tokens_with_local_tokenizer"]
