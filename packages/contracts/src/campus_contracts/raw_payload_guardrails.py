from __future__ import annotations

import re

COMMON_RAW_KEY_TOKENS = (
    "raw_prompt",
    "raw_transcript",
    "provider_raw_response",
    "raw_response",
    "jwt",
    "cookie",
    "auth_envelope",
    "retrieval_backend_dump",
)
COMMON_RAW_VALUE_TOKENS = (
    "authorization:",
    "bearer ",
    "cookie:",
    "set-cookie:",
    "access_token=",
    "refresh_token=",
    "sessionid=",
    "session_id=",
    "sso_tgc=",
    "token=",
)

JWT_VALUE_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")


def normalize_raw_key_token(value: str) -> str:
    return "".join(char for char in value.strip().lower() if char.isalnum())


def reject_raw_mapping_payload(
    value: object,
    field_name: str,
    *,
    forbidden_key_tokens: tuple[str, ...] = COMMON_RAW_KEY_TOKENS,
    forbidden_value_tokens: tuple[str, ...] = COMMON_RAW_VALUE_TOKENS,
    key_error_label: str = "forbidden raw workflow trace key",
    value_error_label: str = "forbidden raw workflow trace value",
    detect_jwt_values: bool = True,
) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if raw_key_matches(str(key), forbidden_key_tokens):
                raise ValueError(f"{field_name} contains {key_error_label}: {key}")
            reject_raw_mapping_payload(
                item,
                field_name,
                forbidden_key_tokens=forbidden_key_tokens,
                forbidden_value_tokens=forbidden_value_tokens,
                key_error_label=key_error_label,
                value_error_label=value_error_label,
                detect_jwt_values=detect_jwt_values,
            )
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            reject_raw_mapping_payload(
                item,
                field_name,
                forbidden_key_tokens=forbidden_key_tokens,
                forbidden_value_tokens=forbidden_value_tokens,
                key_error_label=key_error_label,
                value_error_label=value_error_label,
                detect_jwt_values=detect_jwt_values,
            )
        return
    if isinstance(value, str):
        reject_raw_string_value(
            value,
            field_name,
            forbidden_value_tokens=forbidden_value_tokens,
            value_error_label=value_error_label,
            detect_jwt_values=detect_jwt_values,
        )


def reject_raw_string_value(
    value: str,
    field_name: str,
    *,
    forbidden_value_tokens: tuple[str, ...] = COMMON_RAW_VALUE_TOKENS,
    value_error_label: str = "forbidden raw workflow trace value",
    detect_jwt_values: bool = True,
) -> None:
    normalized = value.strip().lower()
    if not normalized:
        return
    if any(token in normalized for token in forbidden_value_tokens):
        raise ValueError(f"{field_name} contains {value_error_label}")
    if detect_jwt_values and JWT_VALUE_RE.search(value):
        raise ValueError(f"{field_name} contains {value_error_label}")


def raw_key_matches(key_name: str, forbidden_key_tokens: tuple[str, ...]) -> bool:
    normalized_key = normalize_raw_key_token(key_name)
    return any(normalize_raw_key_token(token) in normalized_key for token in forbidden_key_tokens)
