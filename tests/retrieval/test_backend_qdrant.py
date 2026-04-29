import unittest

from tests.retrieval.backend_qdrant_client_settings_suite import *
from tests.retrieval.backend_qdrant_curriculum_ranking_suite import *
from tests.retrieval.backend_qdrant_execution_suite import *
from tests.retrieval.backend_qdrant_filters_suite import *
from tests.retrieval.backend_qdrant_hot_path_suite import *
from tests.retrieval.backend_qdrant_no_hit_suite import *
from tests.retrieval.backend_qdrant_policy_suite import *

if __name__ == "__main__":
    unittest.main()
