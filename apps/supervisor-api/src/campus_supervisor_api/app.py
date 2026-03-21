from __future__ import annotations

from campus_shared import APP_NAME, DELEGATE_TO_RAG_ROUTE


def create_app() -> dict[str, object]:
    """Return a minimal app descriptor until the real HTTP runtime lands."""

    return {
        "name": APP_NAME,
        "routes": [DELEGATE_TO_RAG_ROUTE],
        "mode": "bootstrap",
    }
