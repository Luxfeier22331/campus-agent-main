from __future__ import annotations

import unittest

from tests.ingestion.index_release_acceptance_admission_suite import (
    IndexReleaseAcceptanceAdmissionSuite,
)
from tests.ingestion.index_release_acceptance_chunk_quality_category_suite import (
    IndexReleaseAcceptanceChunkQualityCategorySuite,
)
from tests.ingestion.index_release_acceptance_chunk_quality_contract_suite import (
    IndexReleaseAcceptanceChunkQualityContractSuite,
)
from tests.ingestion.index_release_acceptance_chunk_quality_semantics_suite import (
    IndexReleaseAcceptanceChunkQualitySemanticsSuite,
)
from tests.ingestion.index_release_acceptance_fixture_suite import (
    IndexReleaseAcceptanceFixtureSuite,
)
from tests.ingestion.index_release_acceptance_runtime_suite import (
    IndexReleaseAcceptanceRuntimeSuite,
)


class IndexReleaseAcceptanceTest(
    IndexReleaseAcceptanceChunkQualityContractSuite,
    IndexReleaseAcceptanceChunkQualitySemanticsSuite,
    IndexReleaseAcceptanceChunkQualityCategorySuite,
    IndexReleaseAcceptanceAdmissionSuite,
    IndexReleaseAcceptanceFixtureSuite,
    IndexReleaseAcceptanceRuntimeSuite,
    unittest.TestCase,
):
    pass


if __name__ == "__main__":
    unittest.main()
