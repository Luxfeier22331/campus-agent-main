import unittest

from tests.evals.retrieval_benchmark_cli_suite import *
from tests.evals.retrieval_benchmark_hybrid_fixture_suite import *
from tests.evals.retrieval_benchmark_metrics_suite import *
from tests.evals.retrieval_benchmark_qrels_suite import *
from tests.evals.retrieval_chunk_quality_suite import *
from tests.evals.retrieval_monitoring_suite import *
from tests.evals.retrieval_qrels_coverage_suite import *
from tests.evals.retrieval_tuning_suite import *

if __name__ == "__main__":
    unittest.main()
