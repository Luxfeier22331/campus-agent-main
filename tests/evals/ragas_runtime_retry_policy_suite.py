from __future__ import annotations

from tests.evals.ragas_runtime_test_support import (
    _retry_delay_seconds,
    patch,
    unittest,
)


class SupplementalRetryPolicyTest(unittest.TestCase):
    def test_retry_delay_seconds_uses_exponential_backoff_with_bounded_jitter(self) -> None:
        with patch(
            "campus_evals.supplemental_http.random.uniform", side_effect=lambda low, high: high / 2
        ):
            self.assertEqual(_retry_delay_seconds(1, 1.0), 1.5)
            self.assertEqual(_retry_delay_seconds(2, 1.0), 2.5)
            self.assertEqual(_retry_delay_seconds(3, 1.0), 4.5)
            self.assertEqual(_retry_delay_seconds(0, 1.0), 0.0)
            self.assertEqual(_retry_delay_seconds(2, 0.0), 0.0)
