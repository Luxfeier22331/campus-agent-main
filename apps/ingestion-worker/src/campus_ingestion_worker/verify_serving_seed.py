from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.serving_seed_package import (
    ServingSeedVerifyRequest,
    verify_serving_seed_manifest,
)
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Verify serving seed manifest objects.")
    parser.add_argument("--manifest-path", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    report = verify_serving_seed_manifest(
        request=ServingSeedVerifyRequest(manifest_path=Path(args.manifest_path)),
        object_store=S3ObjectStoreAdmin(settings),
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
