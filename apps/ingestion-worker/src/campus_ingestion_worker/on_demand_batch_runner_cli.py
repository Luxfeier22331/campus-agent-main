from __future__ import annotations

import argparse
import os

from campus_ingestion_core.official_web_release_task import OFFICIAL_WEB_RELEASE_TASK_TYPES

from campus_ingestion_worker import on_demand_batch_runner_support as support


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run bounded ingestion batches on demand and exit with a resource report."
    )
    subparsers = parser.add_subparsers(dest="batch_kind", required=True)

    official = subparsers.add_parser(
        "official-web-handoffs",
        help="Consume pending official_web handoff inbox records.",
    )
    official.add_argument("--event-id")
    official.add_argument("--limit", type=support.positive_int, default=20)
    official.add_argument("--force", action="store_true")
    official.add_argument("--promote", action="store_true")
    official.add_argument("--admit-release-tasks", action="store_true")
    support.add_common_runtime_args(official)

    release_tasks = subparsers.add_parser(
        "official-web-release-tasks",
        help="Claim and execute one queued official_web release task.",
    )
    release_tasks.add_argument("--worker-id", default="official-web-release-task-runner")
    release_tasks.add_argument("--lease-seconds", type=support.positive_int, default=300)
    release_tasks.add_argument("--work-dir", default="./var/official-web-release-tasks")
    release_tasks.add_argument(
        "--task-type",
        action="append",
        choices=sorted(OFFICIAL_WEB_RELEASE_TASK_TYPES),
        default=[],
    )
    release_tasks.add_argument("--declarations-path")
    release_tasks.add_argument("--reset-index", action="store_true")
    support.add_common_runtime_args(release_tasks)

    multimodal = subparsers.add_parser(
        "internal-notice-multimodal-drain",
        help="Drain pending internal_notice multimodal projection rows.",
    )
    multimodal.add_argument("--limit", type=support.positive_int, default=100)
    multimodal.add_argument("--batch-size", type=support.positive_int, default=20)
    multimodal.add_argument("--max-attempts", type=support.positive_int, default=3)
    multimodal.add_argument("--skip-read-model-rebuild", action="store_true")
    multimodal.add_argument(
        "--consumer-admission-manifest-path",
        default=(
            os.getenv("INGESTION_ON_DEMAND_DRAIN_CONSUMER_ADMISSION_MANIFEST_PATH", "").strip()
            or None
        ),
        help=("Path to internal notice consumer admission manifest required by multimodal drain."),
    )
    support.add_common_runtime_args(multimodal)

    closeout = subparsers.add_parser(
        "authenticated-notice-closeout",
        help="Plan/run/validate/promote an authenticated notice closeout batch.",
    )
    closeout.add_argument("--run-id", required=True)
    closeout.add_argument("--bundle-path")
    closeout.add_argument("--manifest-path")
    closeout.add_argument("--site-id")
    closeout.add_argument("--source-home-url")
    closeout.add_argument("--parallel-workers", type=support.positive_int, default=1)
    closeout.add_argument("--worker-id", default="ondemand")
    closeout.add_argument("--shard-size", type=support.positive_int, default=250)
    closeout.add_argument("--batch-size", type=support.positive_int, default=16)
    closeout.add_argument("--max-concurrency", type=support.positive_int, default=1)
    closeout.add_argument("--notice-concurrency", type=support.positive_int, default=2)
    closeout.add_argument("--object-store-concurrency", type=support.positive_int, default=2)
    closeout.add_argument("--lease-seconds", type=support.positive_int, default=300)
    closeout.add_argument("--validate-chunking", action="store_true")
    closeout.add_argument("--promote", action="store_true")
    closeout.add_argument("--media-gate-candidate-inventory-path")
    closeout.add_argument("--media-gate-attempt-ledger-path")
    closeout.add_argument("--media-gate-closeout-candidate-inventory-path")
    closeout.add_argument(
        "--media-gate-target-admission-manifest-path", action="append", default=[]
    )
    closeout.add_argument("--media-gate-cleanup-report-path")
    closeout.add_argument("--media-gate-object-verification-report-path")
    closeout.add_argument(
        "--media-gate-output-dir",
        default="/tmp/media-closeout-state-machine-audit",
    )
    support.add_common_runtime_args(closeout)

    wechat = subparsers.add_parser(
        "wechat-public-notices",
        help="Project selected WeChat public notice source-truth artifacts.",
    )
    wechat.add_argument("--selection-path")
    wechat.add_argument("--article-manifest-key", action="append", default=[])
    wechat.add_argument("--source-bucket")
    wechat.add_argument("--capture-run-id")
    wechat.add_argument("--latest-completed-capture-run", action="store_true")
    wechat.add_argument("--capture-account-slug")
    wechat.add_argument("--dry-run", action="store_true")
    wechat.add_argument("--emit-read-model-evidence", action="store_true")
    support.add_common_runtime_args(wechat)

    wechat_multimodal = subparsers.add_parser(
        "wechat-public-notice-multimodal-drain",
        help="Drain pending WeChat public-notice multimodal projection rows.",
    )
    wechat_multimodal.add_argument("--notice-id", action="append", default=[])
    wechat_multimodal.add_argument("--selection-path")
    wechat_multimodal.add_argument("--limit", type=support.positive_int, default=100)
    wechat_multimodal.add_argument("--batch-size", type=support.positive_int, default=20)
    wechat_multimodal.add_argument("--max-attempts", type=support.positive_int, default=3)
    wechat_multimodal.add_argument("--skip-read-model-rebuild", action="store_true")
    support.add_common_runtime_args(wechat_multimodal)

    return parser
