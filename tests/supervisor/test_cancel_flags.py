from __future__ import annotations

import unittest

from campus_contracts import ExecutionRequest, TraceContext
from campus_supervisor_agent_worker.cancel_flags import CancelFlagStore


def _request(request_id: str, trace_id: str = "trace-001") -> ExecutionRequest:
    return ExecutionRequest(
        user_goal="library hours",
        request_id=request_id,
        trace=TraceContext(trace_id=trace_id),
    )


class CancelFlagStoreTest(unittest.TestCase):
    def test_register_overwrites_stale_cancel_state_for_reused_request_id(self) -> None:
        store = CancelFlagStore()
        store.register(_request("req-reused", "trace-old"), registered_at=100.0)
        self.assertIsNotNone(store.cancel("req-reused", "user_requested"))

        store.register(_request("req-reused", "trace-new"), registered_at=101.0)

        self.assertFalse(store.is_cancel_requested("req-reused"))
        cancelled = store.cancel("req-reused", "second_cancel")
        self.assertIsNotNone(cancelled)
        self.assertEqual(cancelled.trace_id, "trace-new")

    def test_prune_stale_removes_abandoned_cancel_flags_without_publishing_runtime_truth(
        self,
    ) -> None:
        store = CancelFlagStore()
        store.register(_request("req-stale"), registered_at=100.0)
        store.register(_request("req-fresh"), registered_at=109.5)

        removed_count = store.prune_stale(max_age_seconds=5.0, now=110.0)

        self.assertEqual(removed_count, 1)
        self.assertIsNone(store.cancel("req-stale", "late_cancel"))
        self.assertIsNotNone(store.cancel("req-fresh", "user_requested"))


if __name__ == "__main__":
    unittest.main()
