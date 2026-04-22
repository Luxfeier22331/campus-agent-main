import unittest

from tests.evals.retrieval_benchmark_cli_suite import *  # noqa: F401,F403
from tests.evals.retrieval_benchmark_hybrid_fixture_suite import *  # noqa: F401,F403
from tests.evals.retrieval_benchmark_metrics_suite import *  # noqa: F401,F403
from tests.evals.retrieval_benchmark_qrels_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
