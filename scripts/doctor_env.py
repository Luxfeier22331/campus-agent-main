from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Callable, Sequence

from campus_shared import get_repo_env_bootstrap_state, load_repo_env, reset_repo_env_bootstrap_state
from campus_shared.provider_config import (
    EMBEDDING_API_KEY_PRECEDENCE,
    LLM_API_KEY_PRECEDENCE,
    ProviderConfigResolutionError,
    resolve_embedding_provider_config,
    resolve_llm_provider_config,
)


_SURFACE_SPECS = {
    "evals": {
        "llm_surface_name": "eval.ragas",
        "embedding_surface_name": "eval.ragas",
        "required_settings": {
            "ragas_model": ("EVAL_RAGAS_MODEL",),
        },
        "optional_settings": {
            "judge_model": ("EVAL_JUDGE_MODEL", "EVAL_RAGAS_MODEL"),
        },
    },
    "supervisor-api": {
        "llm_surface_name": "supervisor.api",
        "embedding_surface_name": None,
        "required_settings": {},
        "optional_settings": {},
    },
}


def collect_env_doctor_status(*, repo_root: Path, surface: str) -> dict[str, object]:
    normalized_surface = surface.strip().lower()
    if normalized_surface not in _SURFACE_SPECS:
        raise ValueError(
            f"unsupported surface {surface!r}; expected one of {', '.join(sorted(_SURFACE_SPECS))}"
        )

    original_env = dict(os.environ)
    reset_repo_env_bootstrap_state()
    try:
        load_repo_env(repo_root=repo_root.resolve())
        bootstrap_state = get_repo_env_bootstrap_state()
        current_env = dict(os.environ)
        spec = _SURFACE_SPECS[normalized_surface]

        providers = {
            "llm": _collect_provider_status(
                env=current_env,
                surface_name=spec["llm_surface_name"],
                checked_keys=LLM_API_KEY_PRECEDENCE,
                resolver=resolve_llm_provider_config,
            )
        }
        embedding_surface_name = spec["embedding_surface_name"]
        if embedding_surface_name is not None:
            providers["embedding"] = _collect_provider_status(
                env=current_env,
                surface_name=embedding_surface_name,
                checked_keys=EMBEDDING_API_KEY_PRECEDENCE,
                resolver=resolve_embedding_provider_config,
            )

        required_settings = {
            name: _collect_setting_status(current_env, checked_keys=checked_keys, required=True)
            for name, checked_keys in spec["required_settings"].items()
        }
        optional_settings = {
            name: _collect_setting_status(current_env, checked_keys=checked_keys, required=False)
            for name, checked_keys in spec["optional_settings"].items()
        }

        overall_ready = all(status["present"] for status in providers.values()) and all(
            status["present"] for status in required_settings.values()
        )
        return {
            "surface": normalized_surface,
            "overall_ready": overall_ready,
            "bootstrap": {
                "ran": True,
                "candidate_path": (
                    str(bootstrap_state.candidate_path)
                    if bootstrap_state is not None
                    else str(repo_root.resolve() / ".env")
                ),
                "loaded_path": (
                    str(bootstrap_state.loaded_path)
                    if bootstrap_state is not None and bootstrap_state.loaded_path is not None
                    else None
                ),
                "file_found": bool(bootstrap_state.file_found) if bootstrap_state is not None else False,
                "loaded_keys": list(bootstrap_state.loaded_keys) if bootstrap_state is not None else [],
                "skipped_existing_keys": (
                    list(bootstrap_state.skipped_existing_keys) if bootstrap_state is not None else []
                ),
            },
            "providers": providers,
            "settings": {
                "required": required_settings,
                "optional": optional_settings,
            },
        }
    finally:
        os.environ.clear()
        os.environ.update(original_env)
        reset_repo_env_bootstrap_state()


def _collect_provider_status(
    *,
    env: dict[str, str],
    surface_name: str,
    checked_keys: tuple[str, ...],
    resolver: Callable[..., object],
) -> dict[str, object]:
    try:
        resolved = resolver(surface_name, env=env)
    except ProviderConfigResolutionError as exc:
        return {
            "present": False,
            "surface_name": surface_name,
            "checked_keys": list(exc.checked_keys),
            "resolved_key": None,
            "error": str(exc),
        }

    return {
        "present": True,
        "surface_name": surface_name,
        "checked_keys": list(checked_keys),
        "resolved_key": getattr(resolved, "api_key_source", None),
        "error": None,
    }


def _collect_setting_status(
    env: dict[str, str],
    *,
    checked_keys: tuple[str, ...],
    required: bool,
) -> dict[str, object]:
    for key in checked_keys:
        value = env.get(key, "").strip()
        if value:
            return {
                "required": required,
                "present": True,
                "checked_keys": list(checked_keys),
                "resolved_key": key,
                "error": None,
            }
    checked_key_list = list(checked_keys)
    return {
        "required": required,
        "present": False,
        "checked_keys": checked_key_list,
        "resolved_key": None,
        "error": f"missing setting; checked {' > '.join(checked_key_list)}",
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Check repo env bootstrap and surface-scoped provider/settings readiness without "
            "printing secret values."
        )
    )
    parser.add_argument(
        "surface",
        choices=tuple(sorted(_SURFACE_SPECS)),
        help="Logical surface to diagnose, for example evals or supervisor-api.",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Repo root for the current worktree. Defaults to this script's repo root.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the status report as JSON.",
    )
    return parser.parse_args(argv)


def _print_text_report(status: dict[str, object]) -> None:
    print(f"surface={status['surface']}")
    print(f"overall_ready={status['overall_ready']}")
    bootstrap = status["bootstrap"]
    print(f"bootstrap.file_found={bootstrap['file_found']}")
    print(f"bootstrap.loaded_path={bootstrap['loaded_path']}")
    for provider_name, provider_status in status["providers"].items():
        print(
            f"provider.{provider_name}.present={provider_status['present']} "
            f"resolved_key={provider_status['resolved_key']}"
        )
        print(
            "provider."
            f"{provider_name}.checked_keys="
            + ",".join(provider_status["checked_keys"])
        )
        if provider_status["error"]:
            print(f"provider.{provider_name}.error={provider_status['error']}")
    settings = status["settings"]
    for requirement_group in ("required", "optional"):
        for setting_name, setting_status in settings[requirement_group].items():
            print(
                f"setting.{setting_name}.present={setting_status['present']} "
                f"resolved_key={setting_status['resolved_key']}"
            )
            if setting_status["error"] and setting_status["required"]:
                print(f"setting.{setting_name}.error={setting_status['error']}")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    status = collect_env_doctor_status(
        repo_root=args.repo_root.resolve(),
        surface=args.surface,
    )
    if args.json:
        print(json.dumps(status, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        _print_text_report(status)
    return 0 if status["overall_ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
