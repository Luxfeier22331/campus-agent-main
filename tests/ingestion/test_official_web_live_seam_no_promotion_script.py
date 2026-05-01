from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.official_web_live_seam_no_promotion import (
    extract_last_json_object,
    handoff_path_for_run,
    write_json,
)


class OfficialWebLiveSeamNoPromotionScriptTest(unittest.TestCase):
    def test_extract_last_json_object_prefers_trailing_top_level_object(self) -> None:
        output = """
INFO CheerioCrawler: Queue head still returned requests {"requests":[{"id":"abc"}]}
{
  "outputDir": "/tmp/run",
  "crawlRun": {
    "crawlRunId": "owrun_001",
    "status": "completed"
  },
  "uploadedArtifacts": [
    {
      "artifactType": "page_observations",
      "recordCount": 4
    }
  ]
}
""".strip()

        payload = extract_last_json_object(output)

        self.assertEqual(payload["crawlRun"]["crawlRunId"], "owrun_001")
        self.assertEqual(payload["uploadedArtifacts"][0]["artifactType"], "page_observations")

    def test_handoff_path_for_run_selects_current_run_when_inbox_has_backlog(self) -> None:
        with TemporaryDirectory() as temp_dir:
            inbox_dir = Path(temp_dir)
            write_json(
                inbox_dir / "owevt_completed_old.json",
                {"eventId": "old", "payload": {"runId": "owrun_old"}},
            )
            current_path = inbox_dir / "owevt_completed_current.json"
            write_json(
                current_path,
                {"eventId": "current", "payload": {"runId": "owrun_current"}},
            )

            self.assertEqual(handoff_path_for_run(inbox_dir, "owrun_current"), current_path)


if __name__ == "__main__":
    unittest.main()
