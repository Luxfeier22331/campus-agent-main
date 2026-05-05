from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(".")
AGENTIC_RAG_WORKSTREAMS = (
    "agentic-rag-runtime-rearchitecture",
    "campus-agentic-rag-depth-completion",
    "agentic-retrieval-runtime-completion",
    "campus-bounded-autonomous-rag-completion",
)
REQUIRED_LEDGER_FIELDS = (
    "owner:",
    "files:",
    "tests:",
    "evidence:",
    "status:",
)


class AgenticRagCompletionLedgerTest(unittest.TestCase):
    def test_completed_agentic_rag_workstreams_require_gap_ledger(self) -> None:
        registry = (REPO_ROOT / ".planning/WORKSTREAMS.md").read_text(encoding="utf-8")
        completed_section = registry.split("## Completed", maxsplit=1)[1].split(
            "## Deferred",
            maxsplit=1,
        )[0]

        for slug in AGENTIC_RAG_WORKSTREAMS:
            workstream_dir = REPO_ROOT / ".planning/workstreams" / slug
            if slug not in completed_section:
                continue
            with self.subTest(slug=slug):
                ledger_path = workstream_dir / "GAP-LEDGER.md"
                self.assertTrue(
                    ledger_path.exists(),
                    f"{slug} is completed but has no GAP-LEDGER.md completion evidence",
                )
                ledger = ledger_path.read_text(encoding="utf-8")
                self.assertIn("## Completion Audit", ledger)
                self.assertIn("## Gap Ledger", ledger)
                self.assertNotIn("status: pending", ledger)
                self.assertNotIn("status: unverified", ledger)
                entries = _ledger_entries(ledger)
                self.assertGreaterEqual(
                    len(entries),
                    1,
                    f"{slug} GAP-LEDGER.md must contain at least one checked gap entry",
                )
                for entry in entries:
                    for field in REQUIRED_LEDGER_FIELDS:
                        self.assertIn(field, entry)


def _ledger_entries(ledger: str) -> list[str]:
    return [
        entry for entry in re.split(r"\n###\s+", ledger) if entry.startswith(("GAP-", "AUDIT-"))
    ]


if __name__ == "__main__":
    unittest.main()
