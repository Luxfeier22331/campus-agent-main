from __future__ import annotations

import unittest

from tests.evals.ragas_runtime_http_transport_async_suite import *  # noqa: F401,F403
from tests.evals.ragas_runtime_http_transport_embeddings_suite import *  # noqa: F401,F403
from tests.evals.ragas_runtime_http_transport_preflight_suite import *  # noqa: F401,F403
from tests.evals.ragas_runtime_http_transport_sync_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
