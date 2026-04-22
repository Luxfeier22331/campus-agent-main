import unittest

from tests.ingestion.curriculum_chunking_caption_dedupe_suite import *  # noqa: F401,F403
from tests.ingestion.curriculum_chunking_runtime_projection_suite import *  # noqa: F401,F403
from tests.ingestion.curriculum_chunking_section_and_table_units_suite import *  # noqa: F401,F403
from tests.ingestion.curriculum_chunking_structured_units_suite import *  # noqa: F401,F403
from tests.ingestion.curriculum_chunking_table_context_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
