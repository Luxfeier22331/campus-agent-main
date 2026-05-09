from __future__ import annotations

import unittest

from tests.ingestion.registry_scope_release_audit_answer_ready_suite import (
    RegistryScopeReleaseAuditAnswerReadySuite,
)
from tests.ingestion.registry_scope_release_audit_basic_suite import (
    RegistryScopeReleaseAuditBasicSuite,
)
from tests.ingestion.registry_scope_release_publish_suite import (
    RegistryScopeReleasePublishSuite,
)


class RegistryScopeReleaseTest(
    RegistryScopeReleaseAuditBasicSuite,
    RegistryScopeReleaseAuditAnswerReadySuite,
    RegistryScopeReleasePublishSuite,
    unittest.TestCase,
):
    pass
