from __future__ import annotations

from datetime import datetime
from pathlib import Path

from .workstream_runtime_claims import list_workstream_claims
from .workstream_runtime_operator import (
    get_gsd_session_pointer_file,
    get_operator_profile,
    resolve_current_workstream,
    resolve_existing_session_key,
)
from .workstream_runtime_shared import resolve_repo_root, runtime_root


def collect_claim_doctor_status(
    repo_root: Path | str,
    *,
    environ: dict[str, str] | None = None,
    now: datetime | None = None,
) -> dict[str, object]:
    repo = resolve_repo_root(repo_root)
    session_key = resolve_existing_session_key(environ=environ)
    active_workstream = resolve_current_workstream(repo, environ=environ)
    pointer_file = get_gsd_session_pointer_file(repo, session_key) if session_key else None
    return {
        "repo_root": str(repo),
        "runtime_root": str(runtime_root(repo)),
        "operator": get_operator_profile(repo),
        "session_key": session_key,
        "active_workstream": active_workstream,
        "session_pointer_path": str(pointer_file) if pointer_file else None,
        "session_pointer_exists": pointer_file.exists() if pointer_file else False,
        "claims": list_workstream_claims(repo, now=now),
    }
