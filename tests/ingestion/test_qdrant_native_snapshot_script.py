from __future__ import annotations

import json
import os
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "infra" / "local" / "qdrant-native-snapshot.sh"


class QdrantNativeSnapshotScriptTest(unittest.TestCase):
    def test_restore_collection_remaps_alias_to_isolated_target_collection(self) -> None:
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            snapshot_path = temp_path / "student_rules__source.snapshot"
            snapshot_path.write_bytes(b"snapshot")
            checksum = subprocess.check_output(
                ["sha256sum", str(snapshot_path)], text=True
            ).split()[0]
            manifest_path = temp_path / "backup-manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "physical_collection_name": "student_rules__source",
                        "snapshot_file": snapshot_path.name,
                        "snapshot_sha256": checksum,
                        "release_id": "r20260513",
                        "index_release_manifest_key": (
                            "regulations/releases/student_rules/r20260513/index-release.json"
                        ),
                        "serving_alias": "student_rules",
                        "point_count": 20,
                        "alias_bindings": {"student_rules": "student_rules__source"},
                    }
                ),
                encoding="utf-8",
            )
            (temp_path / "sha256.txt").write_text(
                f"{checksum}  {snapshot_path.name}\n", encoding="utf-8"
            )
            alias_request_path = temp_path / "alias-request.json"
            fake_curl_path = temp_path / "curl"
            fake_curl_path.write_text(
                _fake_curl_script(alias_request_path),
                encoding="utf-8",
            )
            fake_curl_path.chmod(0o755)

            env = dict(os.environ)
            env["PATH"] = f"{temp_path}:{env['PATH']}"
            env["QDRANT_URL"] = "http://qdrant.test:6333"
            env["QDRANT_API_KEY"] = "test-key"
            result = subprocess.run(
                [
                    str(SCRIPT_PATH),
                    "restore-collection",
                    "--collection",
                    "student_rules__drill",
                    "--snapshot",
                    str(snapshot_path),
                    "--manifest",
                    str(manifest_path),
                    "--apply-alias",
                ],
                check=True,
                capture_output=True,
                env=env,
                text=True,
            )

            alias_request = json.loads(alias_request_path.read_text(encoding="utf-8"))
            self.assertEqual(
                alias_request,
                {
                    "actions": [
                        {"delete_alias": {"alias_name": "student_rules"}},
                        {
                            "create_alias": {
                                "collection_name": "student_rules__drill",
                                "alias_name": "student_rules",
                            }
                        },
                    ]
                },
            )
            self.assertIn("student_rules__drill", result.stdout)


def _fake_curl_script(alias_request_path: Path) -> str:
    return f"""#!/usr/bin/env bash
set -euo pipefail
payload=""
url="${{@:$#}}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --data)
      payload="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

case "${{url}}" in
  */collections/aliases)
    printf '%s\\n' "${{payload}}" > {str(alias_request_path)!r}
    printf '%s\\n' '{{}}'
    ;;
  */collections/student_rules__drill)
    printf '%s\\n' '{{"result":{{"points_count":20}}}}'
    ;;
  */collections/student_rules__drill/points/scroll)
    printf '%s\\n' '{{"result":{{"points":[{{"payload":{{"index_release_id":"r20260513","index_release_manifest_key":"regulations/releases/student_rules/r20260513/index-release.json","index_release_alias":"student_rules"}}}}]}}}}'
    ;;
  */aliases)
    printf '%s\\n' '{{"result":{{"aliases":[{{"alias_name":"student_rules","collection_name":"student_rules__current"}}]}}}}'
    ;;
  */snapshots/upload*)
    printf '%s\\n' '{{}}'
    ;;
  *)
    printf 'unexpected url: %s\\n' "${{url}}" >&2
    exit 1
    ;;
esac
"""


if __name__ == "__main__":
    unittest.main()
