from __future__ import annotations

from dataclasses import dataclass

from llama_index.core.node_parser import SentenceSplitter


DEFAULT_CHUNK_SIZE = 800
DEFAULT_CHUNK_OVERLAP = 120


@dataclass(frozen=True, slots=True)
class ChunkProfile:
    chunk_size: int = DEFAULT_CHUNK_SIZE
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP

    def __post_init__(self) -> None:
        if self.chunk_size <= 0:
            raise ValueError("chunk_size must be greater than zero")
        if self.chunk_overlap < 0:
            raise ValueError("chunk_overlap must not be negative")
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")

    def build_splitter(self) -> SentenceSplitter:
        return SentenceSplitter.from_defaults(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            include_metadata=False,
        )
