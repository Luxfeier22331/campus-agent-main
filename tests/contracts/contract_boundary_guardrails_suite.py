from __future__ import annotations

import unittest
from pathlib import Path

import campus_contracts
from campus_contracts import models_runtime

CONTRACTS_PACKAGE = Path("packages/contracts/src/campus_contracts")
RETIRED_CAMPUS_SERVICES_LOOKUP_SYMBOLS = (
    "AcademicCalendarLookupPayload",
    "AcademicCalendarLookupResult",
    "AcademicCalendarRelatedContext",
    "ContactDirectoryCandidate",
    "ContactDirectoryContactPoint",
    "ContactDirectoryContactRef",
    "ContactDirectoryEntitySelector",
    "ContactDirectoryLocationRef",
    "ContactDirectoryLookupPayload",
    "ContactDirectoryLookupResult",
    "ContactDirectoryOfficeHours",
    "ServiceGuideCandidate",
    "ServiceGuideContactRef",
    "ServiceGuideEntryRef",
    "ServiceGuideLookupPayload",
    "ServiceGuideLookupResult",
    "ServiceGuideMaterial",
    "ServiceGuideOfficeHours",
    "ServiceGuideProcedureGroup",
    "ServiceGuideProcedureStep",
    "ServiceGuideSection",
    "ServiceGuideServiceRef",
)


class ContractBoundaryGuardrailsTest(unittest.TestCase):
    def test_contracts_do_not_expose_runtime_or_infra_types(self) -> None:
        forbidden_fragments = (
            "Qdrant",
            "MinIO",
            "S3ObjectStore",
            "Agno",
            "openai-agents",
            "openai_agents",
            "from agents",
            "AgentsSdk",
            "AgentsSDK",
            "AgentGraph",
            "AgentHandoff",
            "RunResult",
            "FunctionTool",
            "raw_model_output",
            "raw_provider_response",
            "sdk_run_state",
            "trace_url",
            "LlamaIndex",
            "qdrant_client",
            "llama_index",
            "retired_supervisor_bridge_v",
            "runtime_decisions",
            "terminal_envelope",
        )
        for path in sorted(CONTRACTS_PACKAGE.glob("*.py")):
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                for fragment in forbidden_fragments:
                    self.assertNotIn(fragment, source)

    def test_retired_campus_services_lookups_are_not_public_contracts(self) -> None:
        public_exports = set(campus_contracts.__all__)
        runtime_annotations = "\n".join(
            str(value)
            for value in (
                models_runtime.ToolRequest.__annotations__["payload"],
                models_runtime.ToolResponse.__annotations__["result"],
                models_runtime.ExecutionResponse.__annotations__["result"],
            )
        )

        for symbol in RETIRED_CAMPUS_SERVICES_LOOKUP_SYMBOLS:
            with self.subTest(symbol=symbol):
                self.assertNotIn(symbol, public_exports)
                self.assertFalse(hasattr(campus_contracts, symbol))
                self.assertNotIn(symbol, runtime_annotations)


if __name__ == "__main__":
    unittest.main()
