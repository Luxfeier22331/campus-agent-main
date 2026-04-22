import unittest

from tests.retrieval.backend_qdrant_client_settings_suite import *  # noqa: F401,F403
from tests.retrieval.backend_qdrant_curriculum_ranking_suite import *  # noqa: F401,F403
from tests.retrieval.backend_qdrant_execution_suite import *  # noqa: F401,F403
from tests.retrieval.backend_qdrant_filters_suite import *  # noqa: F401,F403
from tests.retrieval.backend_qdrant_no_hit_suite import *  # noqa: F401,F403
from tests.retrieval.backend_qdrant_policy_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
