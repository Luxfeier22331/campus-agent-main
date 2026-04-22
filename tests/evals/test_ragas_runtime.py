import unittest

from tests.evals.ragas_runtime_dataset_suite import *  # noqa: F401,F403
from tests.evals.ragas_runtime_facade_suite import *  # noqa: F401,F403
from tests.evals.ragas_runtime_http_transport_suite import *  # noqa: F401,F403
from tests.evals.ragas_runtime_retry_policy_suite import *  # noqa: F401,F403
from tests.evals.ragas_runtime_scorer_suite import *  # noqa: F401,F403
from tests.evals.ragas_runtime_settings_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
