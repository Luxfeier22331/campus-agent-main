from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class MockEmbeddingSettings:
    embed_dim: int = 1536
    model_name: str = "mock-embedding"

    def __post_init__(self) -> None:
        if self.embed_dim <= 0:
            raise ValueError("embed_dim must be greater than zero")


class MockEmbeddingModel:
    def __init__(self, settings: MockEmbeddingSettings | None = None) -> None:
        self.settings = settings or MockEmbeddingSettings()
        self.model_name = self.settings.model_name

    def get_text_embedding(self, text: str) -> tuple[float, ...]:
        return _mock_embedding(text, self.settings.embed_dim)

    def get_text_embedding_batch(self, texts: list[str]) -> list[tuple[float, ...]]:
        return [self.get_text_embedding(text) for text in texts]


def build_mock_embedding_model(settings: MockEmbeddingSettings | None = None) -> MockEmbeddingModel:
    return MockEmbeddingModel(settings)


def _mock_embedding(text: str, embed_dim: int) -> tuple[float, ...]:
    seed = sum(ord(char) for char in text)
    return tuple(float((seed + index) % 997) / 997.0 for index in range(embed_dim))
