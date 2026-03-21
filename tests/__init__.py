from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]


def add_workspace_sources() -> None:
    for base in ("apps", "packages"):
        base_path = ROOT / base
        if not base_path.exists():
            continue
        for pyproject in base_path.glob("*/pyproject.toml"):
            src_path = pyproject.parent / "src"
            if src_path.exists():
                src_text = str(src_path)
                if src_text not in sys.path:
                    sys.path.insert(0, src_text)


add_workspace_sources()
