from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"patch target not found in {path}: {old!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


repo = Path("/app/api/hindsight_api/engine")

replace_once(
    repo / "providers" / "openai_compatible_llm.py",
    """        if self.timeout:
            client_kwargs["timeout"] = self.timeout

        self._client = AsyncOpenAI(**client_kwargs)
""",
    """        if self.timeout:
            client_kwargs["timeout"] = self.timeout
        default_headers = kwargs.get("default_headers")
        if default_headers:
            client_kwargs["default_headers"] = default_headers

        self._client = AsyncOpenAI(**client_kwargs)
""",
)

replace_once(
    repo / "llm_wrapper.py",
    """            openai_service_tier=openai_service_tier,
            extra_body=extra_body,
        )
""",
    """            openai_service_tier=openai_service_tier,
            extra_body=extra_body,
            default_headers=default_headers,
        )
""",
)
