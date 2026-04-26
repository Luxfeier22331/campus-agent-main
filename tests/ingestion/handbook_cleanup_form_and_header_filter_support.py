from __future__ import annotations

import unittest

from campus_ingestion_core.readable_text_normalization import normalize_readable_text

from .handbook_cleanup_test_support import *


class HandbookCleanupFormAndHeaderFilterBaseTest(unittest.TestCase):
    pass


__all__ = [name for name in globals() if not name.startswith("__")]
