from __future__ import annotations

import unittest

from campus_evals.langfuse_adapter import (
    LangfuseAdapterDisabled,
    LangfuseAdapterSettings,
    create_langfuse_adapter,
)


class LangfuseAdapterSuite(unittest.TestCase):
    def test_adapter_is_explicitly_disabled_without_configuration(self) -> None:
        adapter = create_langfuse_adapter(LangfuseAdapterSettings())

        with self.assertRaisesRegex(LangfuseAdapterDisabled, "Langfuse adapter is disabled"):
            adapter.publish_scores([])

    def test_adapter_rejects_partial_credentials(self) -> None:
        with self.assertRaisesRegex(ValueError, "public and secret keys"):
            create_langfuse_adapter(
                LangfuseAdapterSettings(
                    base_url="http://langfuse.internal:3000",
                    public_key="pk-lf-test",
                )
            )


if __name__ == "__main__":
    unittest.main()
