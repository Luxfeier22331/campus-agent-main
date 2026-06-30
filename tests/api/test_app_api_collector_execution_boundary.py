from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
APP_API_ROOT = REPO_ROOT / "apps/app-api"

FORBIDDEN_APP_API_COLLECTOR_EXECUTION_REFERENCES = (
    "apps/authenticated-notice-collector/src",
    "apps/official-web-collector/src",
    "apps/wechat-official-account-collector/src",
    "authenticated-notice-collector/src",
    "official-web-collector/src",
    "wechat-official-account-collector/src",
    "pnpm --filter authenticated-notice-collector",
    "pnpm --filter official-web-collector",
    "pnpm --filter wechat-official-account-collector",
    "pnpm --dir apps/authenticated-notice-collector",
    "pnpm --dir apps/official-web-collector",
    "pnpm --dir apps/wechat-official-account-collector",
)

TEXT_SUFFIXES = {".json", ".md", ".mjs", ".mts", ".ts", ".tsx"}


class AppApiCollectorExecutionBoundarySuite(unittest.TestCase):
    def test_app_api_does_not_depend_on_collector_runtime_entrypoints(self) -> None:
        offenders: list[str] = []
        for path in APP_API_ROOT.rglob("*"):
            if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                continue
            text = path.read_text(encoding="utf-8")
            for forbidden in FORBIDDEN_APP_API_COLLECTOR_EXECUTION_REFERENCES:
                if forbidden in text:
                    offenders.append(f"{path.relative_to(REPO_ROOT)}: {forbidden}")

        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
