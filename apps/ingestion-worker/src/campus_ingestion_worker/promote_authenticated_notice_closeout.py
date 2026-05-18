from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_closeout import AuthenticatedNoticeCloseoutService

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Promote a verified authenticated notice async closeout run"
    )
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--media-gate-audit-path", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    service = AuthenticatedNoticeCloseoutService.from_env()
    print(
        json.dumps(
            service.promote_run(
                args.run_id,
                media_gate_audit=_load_json_object(Path(args.media_gate_audit_path)),
            ),
            ensure_ascii=False,
            indent=2,
        )
    )


def _load_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON object expected at {path}")
    return dict(payload)


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
