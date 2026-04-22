import unittest

from tests.ingestion.handbook_cleanup_appendix_semantics_suite import *  # noqa: F401,F403
from tests.ingestion.handbook_cleanup_form_and_header_filter_suite import *  # noqa: F401,F403
from tests.ingestion.handbook_cleanup_inline_heading_suite import *  # noqa: F401,F403
from tests.ingestion.handbook_cleanup_manifest_title_suite import *  # noqa: F401,F403
from tests.ingestion.handbook_cleanup_policy_projection_suite import *  # noqa: F401,F403
from tests.ingestion.handbook_cleanup_table_structure_suite import *  # noqa: F401,F403
from tests.ingestion.handbook_cleanup_text_normalization_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
