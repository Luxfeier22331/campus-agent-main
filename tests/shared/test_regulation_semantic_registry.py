from __future__ import annotations

import unittest

from tests.shared.regulation_semantic_registry_extended_role_suite import (
    RegulationSemanticRegistryExtendedRoleSuite,
)
from tests.shared.regulation_semantic_registry_foundation_suite import (
    RegulationSemanticRegistryFoundationSuite,
)
from tests.shared.regulation_semantic_registry_intro_workflow_suite import (
    RegulationSemanticRegistryIntroWorkflowSuite,
)
from tests.shared.regulation_semantic_registry_procedure_core_suite import (
    RegulationSemanticRegistryProcedureCoreSuite,
)


class RegulationSemanticRegistryTest(
    RegulationSemanticRegistryFoundationSuite,
    RegulationSemanticRegistryProcedureCoreSuite,
    RegulationSemanticRegistryIntroWorkflowSuite,
    RegulationSemanticRegistryExtendedRoleSuite,
    unittest.TestCase,
):
    pass


if __name__ == "__main__":
    unittest.main()
