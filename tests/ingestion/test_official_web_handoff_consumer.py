import unittest

from tests.ingestion.official_web_handoff_consumer_failure_suite import *  # noqa: F401,F403
from tests.ingestion.official_web_handoff_consumer_promotion_gate_suite import *  # noqa: F401,F403
from tests.ingestion.official_web_handoff_consumer_staging_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
