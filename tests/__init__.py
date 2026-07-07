from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def add_repo_venv_site_packages() -> None:
    version = f"python{sys.version_info.major}.{sys.version_info.minor}"
    site_packages = ROOT / ".venv" / "lib" / version / "site-packages"
    if site_packages.exists():
        site_text = str(site_packages)
        if site_text not in sys.path:
            sys.path.insert(0, site_text)


def add_workspace_sources() -> None:
    add_repo_venv_site_packages()
    for base in ("apps", "jobs", "packages"):
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
