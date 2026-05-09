from __future__ import annotations

from tests.ingestion.registry_scope_release_audit_answer_ready_contract_suite import (
    RegistryScopeReleaseAuditAnswerReadyContractSuite,
)
from tests.ingestion.registry_scope_release_audit_answer_ready_provenance_suite import (
    RegistryScopeReleaseAuditAnswerReadyProvenanceSuite,
)


class RegistryScopeReleaseAuditAnswerReadySuite(
    RegistryScopeReleaseAuditAnswerReadyContractSuite,
    RegistryScopeReleaseAuditAnswerReadyProvenanceSuite,
):
    pass
