from __future__ import annotations

import unittest

from tests.shared.answer_ready_evidence_contract_basic_suite import (
    AnswerReadyEvidenceContractBasicSuite,
)
from tests.shared.answer_ready_evidence_contract_category_suite import (
    AnswerReadyEvidenceContractCategorySuite,
)
from tests.shared.answer_ready_evidence_contract_conflict_suite import (
    AnswerReadyEvidenceContractConflictSuite,
)
from tests.shared.answer_ready_evidence_contract_validation_suite import (
    AnswerReadyEvidenceContractValidationSuite,
)


class AnswerReadyEvidenceContractTest(
    AnswerReadyEvidenceContractBasicSuite,
    AnswerReadyEvidenceContractValidationSuite,
    AnswerReadyEvidenceContractConflictSuite,
    AnswerReadyEvidenceContractCategorySuite,
    unittest.TestCase,
):
    pass


if __name__ == "__main__":
    unittest.main()
