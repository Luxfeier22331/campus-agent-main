from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_retired_runtime_helpers import (
    RetiredRuntimeHelperIssue,
    audit_retired_runtime_helpers,
)


class CheckRetiredRuntimeHelpersTest(unittest.TestCase):
    def test_rejects_retired_path(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            path = root / "infra/local/start-execution-control-runtime.sh"
            path.parent.mkdir(parents=True)
            path.write_text("#!/usr/bin/env bash\n", encoding="utf-8")

            self.assertEqual(
                audit_retired_runtime_helpers(root=root),
                (
                    RetiredRuntimeHelperIssue(
                        path="infra/local/start-execution-control-runtime.sh",
                        message="retired runtime helper path must not exist",
                    ),
                ),
            )

    def test_rejects_retired_reference_in_active_docs(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            doc = root / "docs/runbooks/bad.md"
            doc.parent.mkdir(parents=True)
            doc.write_text(
                "Use start-execution-control-staging.sh for staging.\n",
                encoding="utf-8",
            )

            self.assertEqual(
                audit_retired_runtime_helpers(root=root),
                (
                    RetiredRuntimeHelperIssue(
                        path="docs/runbooks/bad.md",
                        message=(
                            "retired runtime helper reference is forbidden: "
                            "start-execution-control-staging.sh"
                        ),
                    ),
                ),
            )


if __name__ == "__main__":
    unittest.main()
