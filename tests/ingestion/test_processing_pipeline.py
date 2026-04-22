import unittest

from tests.ingestion.processing_pipeline_chunk_profile_suite import *  # noqa: F401,F403
from tests.ingestion.processing_pipeline_handbook_suite import *  # noqa: F401,F403
from tests.ingestion.processing_pipeline_metadata_and_authz_suite import *  # noqa: F401,F403
from tests.ingestion.processing_pipeline_official_web_suite import *  # noqa: F401,F403
from tests.ingestion.processing_pipeline_policy_chunking_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
