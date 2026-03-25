from __future__ import annotations

from typing import Sequence


HF_TOKENIZER_ALLOW_PATTERNS = (
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "added_tokens.json",
    "vocab.json",
    "merges.txt",
)


def prefetch_hf_tokenizer(
    repo_id: str,
    *,
    allow_patterns: Sequence[str] = HF_TOKENIZER_ALLOW_PATTERNS,
) -> str:
    return _snapshot_download(repo_id, allow_patterns=allow_patterns)


def resolve_prefetched_hf_tokenizer_path(
    repo_id: str,
    *,
    allow_patterns: Sequence[str] = HF_TOKENIZER_ALLOW_PATTERNS,
) -> str:
    try:
        return _snapshot_download(
            repo_id,
            allow_patterns=allow_patterns,
            local_files_only=True,
        )
    except Exception as exc:
        raise RuntimeError(
            "Tokenizer cache miss for "
            f"{repo_id}. Run `uv run --all-packages python -m campus_ingestion_core.prefetch_tokenizer "
            f"--repo-id {repo_id}` first, then rerun with `HF_HUB_OFFLINE=1`."
        ) from exc


def _snapshot_download(
    repo_id: str,
    *,
    allow_patterns: Sequence[str],
    local_files_only: bool = False,
) -> str:
    from huggingface_hub import snapshot_download

    return snapshot_download(
        repo_id,
        allow_patterns=tuple(allow_patterns),
        local_files_only=local_files_only,
    )
