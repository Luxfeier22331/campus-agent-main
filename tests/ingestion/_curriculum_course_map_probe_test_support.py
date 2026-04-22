from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_INGESTION_CORE_PACKAGE_DIR = (
    _REPO_ROOT / "packages" / "ingestion-core" / "src" / "campus_ingestion_core"
)
_INGESTION_WORKER_PACKAGE_DIR = (
    _REPO_ROOT / "apps" / "ingestion-worker" / "src" / "campus_ingestion_worker"
)


def _ensure_package_stub(name: str, package_dir: Path) -> None:
    module = sys.modules.get(name)
    if module is None:
        module = types.ModuleType(name)
        module.__path__ = [str(package_dir)]
        sys.modules[name] = module
        return
    module.__path__ = [str(package_dir)]


def _load_module(module_name: str, file_path: Path):
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load module spec for {module_name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def load_curriculum_course_map_probe_module():
    _ensure_package_stub("campus_ingestion_core", _INGESTION_CORE_PACKAGE_DIR)
    return _load_module(
        "campus_ingestion_core.curriculum_course_map_multimodal_probe",
        _INGESTION_CORE_PACKAGE_DIR / "curriculum_course_map_multimodal_probe.py",
    )


def load_probe_curriculum_course_maps_worker_module():
    _ensure_package_stub("campus_ingestion_core", _INGESTION_CORE_PACKAGE_DIR)
    _ensure_package_stub("campus_ingestion_worker", _INGESTION_WORKER_PACKAGE_DIR)
    return _load_module(
        "campus_ingestion_worker.probe_curriculum_course_maps",
        _INGESTION_WORKER_PACKAGE_DIR / "probe_curriculum_course_maps.py",
    )
