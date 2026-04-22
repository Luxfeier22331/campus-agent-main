from __future__ import annotations

import unittest

from tests.supervisor.supervisor_core_audit_record_suite import *  # noqa: F401,F403
from tests.supervisor.supervisor_core_observability_context_suite import *  # noqa: F401,F403
from tests.supervisor.supervisor_core_prompt_execution_suite import *  # noqa: F401,F403
from tests.supervisor.supervisor_core_routing_suite import *  # noqa: F401,F403
from tests.supervisor.supervisor_core_specialist_policy_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
