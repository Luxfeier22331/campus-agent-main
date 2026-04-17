from __future__ import annotations

import unittest

from campus_contracts import PromptTrace
from campus_shared import (
    NormalizedProviderGroundingSupport,
    PromptRuntimeValidationError,
    normalize_provider_grounding_supports,
    validate_prompt_trace_contract,
)
from campus_supervisor_core.prompts.registry import get_supervisor_prompt_spec


class PromptRuntimeValidationTest(unittest.TestCase):
    def test_validate_prompt_trace_requires_model_metadata(self) -> None:
        spec = get_supervisor_prompt_spec("supervisor_clarify_v1")
        with self.assertRaises(PromptRuntimeValidationError):
            validate_prompt_trace_contract(
                prompt_trace=PromptTrace(
                    prompt_id="supervisor_clarify_v1",
                    prompt_version="v1",
                    template_sha256=spec.template_sha256,
                    variables_schema_version=spec.variables_schema_version,
                    output_schema_version=spec.output_schema_version,
                ),
                spec=spec,
            )

    def test_normalize_provider_grounding_supports_flattens_common_provider_shapes(self) -> None:
        supports = normalize_provider_grounding_supports(
            {
                "supports": [
                    {
                        "claimText": "第四学期",
                        "docId": "curriculum:law-ethnic-experimental",
                        "snippet": "第四学期开设习近平新时代中国特色社会主义思想概论。",
                    },
                    {
                        "claim_text": "3学分",
                        "support_source_doc_id": "curriculum:law-ethnic-experimental",
                        "support_snippet": "习近平新时代中国特色社会主义思想概论 3学分。",
                    },
                ]
            }
        )

        self.assertEqual(
            supports,
            (
                NormalizedProviderGroundingSupport(
                    claim_text="第四学期",
                    support_source_doc_id="curriculum:law-ethnic-experimental",
                    support_snippet="第四学期开设习近平新时代中国特色社会主义思想概论。",
                ),
                NormalizedProviderGroundingSupport(
                    claim_text="3学分",
                    support_source_doc_id="curriculum:law-ethnic-experimental",
                    support_snippet="习近平新时代中国特色社会主义思想概论 3学分。",
                ),
            ),
        )


if __name__ == "__main__":
    unittest.main()
