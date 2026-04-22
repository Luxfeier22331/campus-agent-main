import unittest

from tests.ingestion.rebuild_local_data_cleanup_suite import *  # noqa: F401,F403
from tests.ingestion.rebuild_local_data_migration_suite import *  # noqa: F401,F403
from tests.ingestion.rebuild_local_data_replay_suite import *  # noqa: F401,F403
from tests.ingestion.rebuild_local_data_runtime_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
