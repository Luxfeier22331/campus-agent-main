import unittest

from tests.ingestion.authenticated_notice_closeout_async_model_and_planner_suite import *  # noqa: F401,F403
from tests.ingestion.authenticated_notice_closeout_async_planning_inventory_suite import *  # noqa: F401,F403
from tests.ingestion.authenticated_notice_closeout_async_store_locking_suite import *  # noqa: F401,F403
from tests.ingestion.authenticated_notice_closeout_async_verification_and_promotion_suite import *  # noqa: F401,F403
from tests.ingestion.authenticated_notice_closeout_async_verifier_suite import *  # noqa: F401,F403
from tests.ingestion.authenticated_notice_closeout_async_worker_stage_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
