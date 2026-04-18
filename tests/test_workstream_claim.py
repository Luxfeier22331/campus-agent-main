from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import subprocess
import unittest

from scripts.workstream_claim import run_session_command
from scripts.workstream_runtime import (
    ClaimConflictError,
    accept_workstream_handoff,
    acquire_workstream_claim,
    clear_operator_profile,
    get_gsd_session_pointer_file,
    get_operator_profile,
    get_workstream_claim_status,
    handoff_workstream_claim,
    release_workstream_claim,
    renew_workstream_claim,
    set_operator_profile,
)


ROOT = Path(__file__).resolve().parents[1]


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _seed_repo(root: Path, *workstreams: str) -> None:
    _write(root / "README.md", "# campus-agent\n")
    for workstream in workstreams:
        _write(
            root / ".planning" / "workstreams" / workstream / "STATE.md",
            "---\nworkstream: %s\n---\n" % workstream,
        )


def _utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


class WorkstreamClaimRuntimeTest(unittest.TestCase):
    def test_operator_profile_round_trips(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _seed_repo(repo_root, "shared-product-surfaces-acceptance-hardening")

            operator = set_operator_profile(
                repo_root=repo_root,
                operator_id="alice",
                display_name="Alice",
            )

            self.assertEqual(operator["operator_id"], "alice")
            self.assertEqual(operator["display_name"], "Alice")
            self.assertEqual(get_operator_profile(repo_root)["operator_id"], "alice")

            clear_operator_profile(repo_root)

            self.assertIsNone(get_operator_profile(repo_root))

    def test_active_claim_blocks_other_operator_until_expiry(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            slug = "shared-product-surfaces-acceptance-hardening"
            _seed_repo(repo_root, slug)
            now = datetime(2026, 4, 19, 4, 0, tzinfo=timezone.utc)

            first_claim = acquire_workstream_claim(
                repo_root=repo_root,
                workstream=slug,
                operator_id="alice",
                session_key="session-alice",
                lease_seconds=20 * 60,
                heartbeat_interval_seconds=60,
                now=now,
            )

            self.assertEqual(first_claim["status"], "active")
            self.assertEqual(
                get_workstream_claim_status(repo_root, slug, now=now)["effective_status"],
                "active",
            )

            with self.assertRaises(ClaimConflictError):
                acquire_workstream_claim(
                    repo_root=repo_root,
                    workstream=slug,
                    operator_id="bob",
                    session_key="session-bob",
                    lease_seconds=20 * 60,
                    heartbeat_interval_seconds=60,
                    now=now + timedelta(minutes=5),
                )

            expired_status = get_workstream_claim_status(
                repo_root,
                slug,
                now=now + timedelta(minutes=21),
            )
            self.assertEqual(expired_status["effective_status"], "expired")

            second_claim = acquire_workstream_claim(
                repo_root=repo_root,
                workstream=slug,
                operator_id="bob",
                session_key="session-bob",
                lease_seconds=20 * 60,
                heartbeat_interval_seconds=60,
                now=now + timedelta(minutes=21),
                reason="claim expired",
            )

            self.assertNotEqual(second_claim["claim_id"], first_claim["claim_id"])
            self.assertEqual(second_claim["operator_id"], "bob")

    def test_handoff_accept_rotates_owner_and_invalidates_old_heartbeat(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            slug = "shared-file-asset-loader-contract"
            _seed_repo(repo_root, slug)
            now = datetime(2026, 4, 19, 4, 0, tzinfo=timezone.utc)

            first_claim = acquire_workstream_claim(
                repo_root=repo_root,
                workstream=slug,
                operator_id="alice",
                session_key="session-alice",
                lease_seconds=20 * 60,
                heartbeat_interval_seconds=60,
                now=now,
            )

            handoff_claim = handoff_workstream_claim(
                repo_root=repo_root,
                workstream=slug,
                claim_id=first_claim["claim_id"],
                operator_id="alice",
                session_key="session-alice",
                to_operator_id="bob",
                note="请接手收口",
                now=now + timedelta(minutes=1),
            )

            self.assertEqual(handoff_claim["status"], "handoff_pending")
            self.assertEqual(handoff_claim["handoff_to_operator_id"], "bob")

            accepted_claim = accept_workstream_handoff(
                repo_root=repo_root,
                workstream=slug,
                operator_id="bob",
                session_key="session-bob",
                now=now + timedelta(minutes=2),
            )

            self.assertEqual(accepted_claim["status"], "active")
            self.assertEqual(accepted_claim["operator_id"], "bob")
            self.assertNotEqual(accepted_claim["claim_id"], first_claim["claim_id"])

            stale_renewal = renew_workstream_claim(
                repo_root=repo_root,
                workstream=slug,
                claim_id=first_claim["claim_id"],
                operator_id="alice",
                session_key="session-alice",
                now=now + timedelta(minutes=3),
            )
            fresh_renewal = renew_workstream_claim(
                repo_root=repo_root,
                workstream=slug,
                claim_id=accepted_claim["claim_id"],
                operator_id="bob",
                session_key="session-bob",
                now=now + timedelta(minutes=3),
            )

            self.assertFalse(stale_renewal["renewed"])
            self.assertTrue(fresh_renewal["renewed"])

    def test_run_session_command_sets_gsd_env_and_releases_claim_on_exit(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            slug = "shared-product-surfaces-acceptance-hardening"
            session_key = "codex-thread-123"
            _seed_repo(repo_root, slug)

            captured: dict[str, object] = {}

            def fake_runner(
                argv: list[str],
                *,
                cwd: Path,
                env: dict[str, str],
            ) -> subprocess.CompletedProcess[str]:
                captured["argv"] = argv
                captured["cwd"] = cwd
                captured["env"] = env
                captured["claim_status_during_run"] = get_workstream_claim_status(repo_root, slug)
                pointer_file = get_gsd_session_pointer_file(repo_root, session_key)
                captured["pointer_exists_during_run"] = pointer_file.exists()
                captured["pointer_value_during_run"] = (
                    pointer_file.read_text(encoding="utf-8").strip() if pointer_file.exists() else None
                )
                return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")

            exit_code = run_session_command(
                repo_root=repo_root,
                workstream=slug,
                command=["bash", "-lc", "exit 0"],
                operator_id="alice",
                session_key=session_key,
                runner=fake_runner,
                lease_seconds=20 * 60,
                heartbeat_interval_seconds=600,
            )

            self.assertEqual(exit_code, 0)
            self.assertEqual(captured["cwd"], repo_root)
            env = captured["env"]
            self.assertEqual(env["GSD_WORKSTREAM"], slug)
            self.assertEqual(env["GSD_SESSION_KEY"], session_key)
            self.assertEqual(env["GSD_OPERATOR_ID"], "alice")
            self.assertTrue(env["CAMPUS_WORKSTREAM_CLAIM_ID"])
            self.assertEqual(
                captured["claim_status_during_run"]["effective_status"],
                "active",
            )
            self.assertTrue(captured["pointer_exists_during_run"])
            self.assertEqual(captured["pointer_value_during_run"], slug)

            released_status = get_workstream_claim_status(repo_root, slug)
            self.assertEqual(released_status["effective_status"], "unclaimed")
            self.assertFalse(get_gsd_session_pointer_file(repo_root, session_key).exists())

    def test_release_removes_current_claim(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            slug = "shared-file-asset-loader-contract"
            _seed_repo(repo_root, slug)
            now = datetime(2026, 4, 19, 4, 0, tzinfo=timezone.utc)

            claim = acquire_workstream_claim(
                repo_root=repo_root,
                workstream=slug,
                operator_id="alice",
                session_key="session-alice",
                now=now,
            )

            released = release_workstream_claim(
                repo_root=repo_root,
                workstream=slug,
                claim_id=claim["claim_id"],
                operator_id="alice",
                session_key="session-alice",
                reason="work completed",
                now=now + timedelta(minutes=1),
            )

            self.assertTrue(released["released"])
            self.assertEqual(get_workstream_claim_status(repo_root, slug)["effective_status"], "unclaimed")


class WorkstreamClaimDocsContractTest(unittest.TestCase):
    def test_repo_docs_reference_repo_owned_claim_workflow(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")
        agents = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        workstreams = (ROOT / ".planning" / "WORKSTREAMS.md").read_text(encoding="utf-8")
        runbooks_index = (ROOT / "docs" / "runbooks" / "README.md").read_text(encoding="utf-8")
        runbook = (
            ROOT / "docs" / "runbooks" / "workstream-claim-workflow.md"
        ).read_text(encoding="utf-8")

        self.assertIn("workstream-claim-workflow.md", readme)
        self.assertIn("python -m scripts.workstream_claim", readme)
        self.assertIn("operator set", contributing)
        self.assertIn("session shell", contributing)
        self.assertIn("repo-owned claim workflow", agents)
        self.assertIn(".planning/runtime/", workstreams)
        self.assertIn("workstream-claim-workflow.md", runbooks_index)
        self.assertIn("session start <slug> -- <cmd...>", runbook)
        self.assertIn("claim handoff", runbook)


if __name__ == "__main__":
    unittest.main()
