from __future__ import annotations

import argparse

from campus_ingestion_core.chunking import QWEN3_EMBEDDING_REPO
from campus_ingestion_core.tokenizer_cache import prefetch_hf_tokenizer


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prefetch Hugging Face tokenizer files for offline ingestion runtime."
    )
    parser.add_argument(
        "--repo-id",
        default=QWEN3_EMBEDDING_REPO,
        help=f"Hugging Face repo id to prefetch (default: {QWEN3_EMBEDDING_REPO})",
    )
    args = parser.parse_args()

    local_path = prefetch_hf_tokenizer(args.repo_id)
    print(local_path)


if __name__ == "__main__":
    main()
