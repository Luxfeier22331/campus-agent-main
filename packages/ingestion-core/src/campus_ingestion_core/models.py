from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class DocumentRegistryRecord:
    document_id: str
    version_id: str
    source_uri: str
    content_hash: str
    corpus: str
    acl_groups: tuple[str, ...] = field(default_factory=tuple)
    campus_scope: str | None = None
    status: str = "active"
    ingestion_timestamp: str = ""
    parser_version: str = ""
    embedding_model: str = ""
    raw_object_key: str | None = None
    raw_content_hash: str | None = None
    raw_source_filename: str | None = None
    raw_page_start: int | None = None
    raw_page_end: int | None = None
    structured_object_key: str | None = None
    provider_result_object_key: str | None = None
    processed_object_keys: tuple[str, ...] = field(default_factory=tuple)
    import_source: str = ""

    def __post_init__(self) -> None:
        if self.corpus != "student_handbook":
            raise ValueError(f"unsupported corpus: {self.corpus}")
        if not self.document_id:
            raise ValueError("document_id is required")
        if not self.version_id:
            raise ValueError("version_id is required")
        if not self.source_uri:
            raise ValueError("source_uri is required")
        if not self.content_hash:
            raise ValueError("content_hash is required")
        if not self.status:
            raise ValueError("status is required")
        if not self.ingestion_timestamp:
            raise ValueError("ingestion_timestamp is required")
        if not self.parser_version:
            raise ValueError("parser_version is required")
        if not self.import_source:
            raise ValueError("import_source is required")
