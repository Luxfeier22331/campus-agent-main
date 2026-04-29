from __future__ import annotations


class RetrievalBackendError(RuntimeError):
    pass


class CorpusQueryDisabledError(RetrievalBackendError):
    pass


class RestrictedDocumentAccessDeniedError(RetrievalBackendError):
    pass


__all__ = [
    "CorpusQueryDisabledError",
    "RestrictedDocumentAccessDeniedError",
    "RetrievalBackendError",
]
