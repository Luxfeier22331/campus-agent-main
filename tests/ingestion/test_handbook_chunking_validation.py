import unittest

from tests.ingestion.handbook_chunking_validation_registry_and_report_suite import *  # noqa: F401,F403
from tests.ingestion.handbook_chunking_validation_scan_and_cache_suite import *  # noqa: F401,F403
from tests.ingestion.handbook_chunking_validation_table_and_appendix_suite import *  # noqa: F401,F403
from tests.ingestion.handbook_chunking_validation_textual_failures_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
