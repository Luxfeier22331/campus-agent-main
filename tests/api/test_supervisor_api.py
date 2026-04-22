from __future__ import annotations

import unittest

from tests.api.supervisor_api_answer_projection_suite import *  # noqa: F401,F403
from tests.api.supervisor_api_audit_suite import *  # noqa: F401,F403
from tests.api.supervisor_api_auth_headers_suite import *  # noqa: F401,F403
from tests.api.supervisor_api_settings_and_health_suite import *  # noqa: F401,F403
from tests.api.supervisor_api_trusted_worker_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
