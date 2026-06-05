# campus-prompt-runtime

Provider-facing prompt runtime for campus-agent v2.

This package owns prompt packet validation, structured provider execution,
provider response normalization and prompt trace construction. It is a stable
capability boundary for semantic worker and RAG prompt execution code.

Do not re-export this package through `campus-shared`; consumers must depend on
`campus-prompt-runtime` explicitly.
