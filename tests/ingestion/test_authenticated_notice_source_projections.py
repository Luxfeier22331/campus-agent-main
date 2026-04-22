import unittest

from tests.ingestion.authenticated_notice_source_projection_attachment_extractable_suite import *  # noqa: F401,F403
from tests.ingestion.authenticated_notice_source_projection_attachment_ocr_suite import *  # noqa: F401,F403
from tests.ingestion.authenticated_notice_source_projection_chunking_suite import *  # noqa: F401,F403
from tests.ingestion.authenticated_notice_source_projection_classification_suite import *  # noqa: F401,F403
from tests.ingestion.authenticated_notice_source_projection_inline_image_context_suite import *  # noqa: F401,F403
from tests.ingestion.authenticated_notice_source_projection_inline_image_reference_suite import *  # noqa: F401,F403
from tests.ingestion.authenticated_notice_source_projection_title_suite import *  # noqa: F401,F403

if __name__ == "__main__":
    unittest.main()
