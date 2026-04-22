from __future__ import annotations

import unittest

from tests.retrieval.backend_qdrant_curriculum_ranking_backend_suite import *  # noqa: F401,F403
from tests.retrieval.backend_qdrant_curriculum_ranking_metadata_suite import *  # noqa: F401,F403
from tests.retrieval.backend_qdrant_curriculum_ranking_prioritization_suite import *  # noqa: F401,F403
from tests.retrieval.backend_qdrant_curriculum_ranking_query_text_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
