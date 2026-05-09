from __future__ import annotations

import unittest
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.official_web_release_task import build_official_web_release_task
from campus_ingestion_core.official_web_release_task_store import (
    InMemoryOfficialWebReleaseTaskStore,
)
from campus_ingestion_worker.run_official_web_release_task import run_official_web_release_task_once


@dataclass(frozen=True, slots=True)
class _ReleaseResult:
    status: str
    release_id: str
    corpus: str = "campus_services"
    collection: str = "contact_directory"
    record_count: int = 1
    full_record_count: int = 2
    task_scope_display_names: tuple[str, ...] = ("中央民族大学信息公开联系方式",)
    full_impact_display_names: tuple[str, ...] = (
        "中央民族大学",
        "中央民族大学信息公开联系方式",
    )
    document_ids: tuple[str, ...] = ()
    source_bundle_key: str = "official_web/muc_public/runs/owrun/source-truth-bundle.json"


class _Reporter:
    def __init__(self) -> None:
        self.snapshots: list[dict[str, object]] = []

    def report(self, *, snapshots: object | None = None, snapshot: object | None = None) -> None:
        if snapshots is not None:
            self.snapshots.extend(list(snapshots))  # type: ignore[arg-type]
            return
        if snapshot is not None:
            self.snapshots.append(dict(snapshot))  # type: ignore[arg-type]


def _selected_write_task() -> object:
    return build_official_web_release_task(
        input_ref={
            "sourceObjectKeys": ["official_web/muc_public/runs/owrun/source-truth-bundle.json"],
            "sourceUrls": ["https://www.muc.edu.cn/"],
        },
        inventory_id="muc-main-homepage-contact",
        job_id="owtarget_contact",
        run_id="owrun",
        selected_write_target="campus_services/contact_directory",
        task_id="owrelease_contact",
        task_type="official_web_selected_write_contact_directory",
        now=datetime(2026, 5, 1, 8, 0, tzinfo=UTC),
    )


def _selected_write_service_guide_task() -> object:
    return build_official_web_release_task(
        input_ref={
            "sourceObjectKeys": ["official_web/muc_public/runs/owrun/source-truth-bundle.json"],
            "sourceUrls": ["https://met.muc.edu.cn/info/1027/1127.htm"],
        },
        inventory_id="muc-it-student-campus-card-service-guide",
        job_id="owtarget_service_guide",
        run_id="owrun",
        selected_write_target="campus_services/service_guide",
        task_id="owrelease_service_guide",
        task_type="official_web_selected_write_service_guide",
        now=datetime(2026, 5, 1, 8, 2, tzinfo=UTC),
    )


class RunOfficialWebReleaseTaskWorkerTest(unittest.TestCase):
    def test_claims_dispatches_selected_write_and_publishes_task_projection(self) -> None:
        store = InMemoryOfficialWebReleaseTaskStore()
        store.create_or_get_task(_selected_write_task())
        reporter = _Reporter()
        calls: list[dict[str, object]] = []

        def fake_selected_write_release(**kwargs: object) -> _ReleaseResult:
            calls.append(dict(kwargs))
            return _ReleaseResult(status="published", release_id="release_contact")

        with TemporaryDirectory() as temp_dir:
            result = run_official_web_release_task_once(
                derived_object_store=object(),
                object_store=object(),
                projection_reporter=reporter,
                release_selected_write_func=fake_selected_write_release,
                release_store=store,
                release_target_func=None,
                structured_projection_publisher=object(),
                worker_id="worker-a",
                work_dir=Path(temp_dir),
                now=lambda: datetime(2026, 5, 1, 8, 1, tzinfo=UTC),
            )

        self.assertIsNotNone(result)
        self.assertEqual(result.task_id, "owrelease_contact")
        self.assertEqual(result.status, "published")
        persisted = store.get_task("owrelease_contact")
        self.assertIsNotNone(persisted)
        self.assertEqual(persisted.status, "published")  # type: ignore[union-attr]
        self.assertEqual(calls[0]["release_task"].status, "running")
        self.assertEqual(
            [snapshot["lifecycleStatus"] for snapshot in reporter.snapshots],
            ["claimed", "running", "published"],
        )
        self.assertEqual(
            reporter.snapshots[-1]["outputSummary"]["taskScopeDisplayNames"],
            ["中央民族大学信息公开联系方式"],
        )
        self.assertEqual(reporter.snapshots[-1]["outputSummary"]["fullRecordCount"], 2)
        self.assertEqual(
            reporter.snapshots[-1]["outputSummary"]["fullImpactDisplayNames"],
            ["中央民族大学", "中央民族大学信息公开联系方式"],
        )

    def test_service_guide_selected_write_publishes_full_impact_summary_projection(self) -> None:
        store = InMemoryOfficialWebReleaseTaskStore()
        store.create_or_get_task(_selected_write_service_guide_task())
        reporter = _Reporter()

        def fake_selected_write_release(**_: object) -> _ReleaseResult:
            return _ReleaseResult(
                status="published",
                release_id="release_service_guide",
                collection="service_guide",
                record_count=1,
                full_record_count=2,
                task_scope_display_names=("中央民族大学信息公开依申请公开工作流程",),
                full_impact_display_names=(
                    "学生校园卡服务",
                    "中央民族大学信息公开依申请公开工作流程",
                ),
            )

        with TemporaryDirectory() as temp_dir:
            result = run_official_web_release_task_once(
                derived_object_store=object(),
                object_store=object(),
                projection_reporter=reporter,
                release_selected_write_func=fake_selected_write_release,
                release_store=store,
                release_target_func=None,
                structured_projection_publisher=object(),
                worker_id="worker-a",
                work_dir=Path(temp_dir),
                now=lambda: datetime(2026, 5, 1, 8, 3, tzinfo=UTC),
            )

        self.assertIsNotNone(result)
        self.assertEqual(result.task_id, "owrelease_service_guide")
        self.assertEqual(
            reporter.snapshots[-1]["outputSummary"]["taskScopeDisplayNames"],
            ["中央民族大学信息公开依申请公开工作流程"],
        )
        self.assertEqual(reporter.snapshots[-1]["outputSummary"]["fullRecordCount"], 2)
        self.assertEqual(
            reporter.snapshots[-1]["outputSummary"]["fullImpactDisplayNames"],
            ["学生校园卡服务", "中央民族大学信息公开依申请公开工作流程"],
        )

    def test_task_id_executes_selected_task_without_claiming_older_matching_type(self) -> None:
        store = InMemoryOfficialWebReleaseTaskStore()
        store.create_or_get_task(_selected_write_task())
        store.create_or_get_task(_selected_write_service_guide_task())
        calls: list[str] = []

        def fake_selected_write_release(**kwargs: object) -> _ReleaseResult:
            release_task = kwargs["release_task"]
            calls.append(release_task.task_id)  # type: ignore[attr-defined]
            return _ReleaseResult(
                status="published",
                release_id="release_service_guide",
                collection="service_guide",
            )

        with TemporaryDirectory() as temp_dir:
            result = run_official_web_release_task_once(
                derived_object_store=object(),
                object_store=object(),
                release_selected_write_func=fake_selected_write_release,
                release_store=store,
                release_target_func=None,
                structured_projection_publisher=object(),
                task_id="owrelease_service_guide",
                worker_id="worker-a",
                work_dir=Path(temp_dir),
                now=lambda: datetime(2026, 5, 1, 8, 3, tzinfo=UTC),
            )

        self.assertIsNotNone(result)
        self.assertEqual(result.task_id, "owrelease_service_guide")
        self.assertEqual(calls, ["owrelease_service_guide"])
        self.assertEqual(store.get_task("owrelease_service_guide").status, "published")  # type: ignore[union-attr]
        self.assertEqual(store.get_task("owrelease_contact").status, "queued")  # type: ignore[union-attr]

    def test_retryable_failure_updates_task_and_reports_failure_projection(self) -> None:
        store = InMemoryOfficialWebReleaseTaskStore()
        store.create_or_get_task(_selected_write_task())
        reporter = _Reporter()

        class RetryableBoom(RuntimeError):
            code = "object_store_unavailable"
            retryable = True

        def fake_selected_write_release(**_: object) -> _ReleaseResult:
            raise RetryableBoom("object store unavailable")

        with TemporaryDirectory() as temp_dir:
            result = run_official_web_release_task_once(
                derived_object_store=object(),
                object_store=object(),
                projection_reporter=reporter,
                release_selected_write_func=fake_selected_write_release,
                release_store=store,
                release_target_func=None,
                structured_projection_publisher=object(),
                worker_id="worker-a",
                work_dir=Path(temp_dir),
                now=lambda: datetime(2026, 5, 1, 8, 1, tzinfo=UTC),
            )

        self.assertIsNotNone(result)
        self.assertEqual(result.status, "failed_retryable")
        persisted = store.get_task("owrelease_contact")
        self.assertIsNotNone(persisted)
        self.assertEqual(persisted.status, "failed_retryable")  # type: ignore[union-attr]
        self.assertEqual(persisted.last_error_code, "object_store_unavailable")  # type: ignore[union-attr]
        self.assertEqual(reporter.snapshots[-1]["lifecycleStatus"], "failed_retryable")


if __name__ == "__main__":
    unittest.main()
