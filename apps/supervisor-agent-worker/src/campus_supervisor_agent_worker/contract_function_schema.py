from __future__ import annotations

import types
from dataclasses import MISSING, Field, fields, is_dataclass
from enum import StrEnum
from typing import Any, get_args, get_origin, get_type_hints

from campus_contracts.schema_metadata import (
    SCHEMA_DESCRIPTION,
    SCHEMA_ENUM_VALUES,
    SCHEMA_EXCLUDE,
    SCHEMA_MINIMUM,
    SCHEMA_SEMANTIC_REQUIRED,
)


class ContractFunctionSchemaError(ValueError):
    pass


def provider_parameters_schema_for_type(payload_type: type[object]) -> dict[str, Any]:
    if not isinstance(payload_type, type) or not is_dataclass(payload_type):
        raise ContractFunctionSchemaError(
            f"provider function payload must be a dataclass type, got {payload_type!r}"
        )
    return _object_schema_for_dataclass(payload_type)


def _object_schema_for_dataclass(payload_type: type[object]) -> dict[str, Any]:
    resolved_types = get_type_hints(payload_type, include_extras=True)
    properties: dict[str, Any] = {}
    for dataclass_field in fields(payload_type):
        if dataclass_field.metadata.get(SCHEMA_EXCLUDE, False):
            continue
        description = _required_description(payload_type, dataclass_field)
        annotation = resolved_types.get(dataclass_field.name, dataclass_field.type)
        field_schema, annotation_nullable = _schema_for_annotation(
            annotation,
            description=description,
            dataclass_name=payload_type.__name__,
            field_name=dataclass_field.name,
            metadata=dataclass_field.metadata,
        )
        if annotation_nullable or not _is_semantically_required(dataclass_field):
            field_schema = _nullable_schema(field_schema)
        properties[dataclass_field.name] = field_schema
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": list(properties),
    }


def _schema_for_annotation(
    annotation: object,
    *,
    description: str,
    dataclass_name: str,
    field_name: str,
    metadata: Any,
) -> tuple[dict[str, Any], bool]:
    union_args = _union_args(annotation)
    if union_args is not None:
        non_none_args = tuple(arg for arg in union_args if arg is not type(None))
        allows_none = len(non_none_args) != len(union_args)
        enum_values = _enum_values_for_annotation(annotation, metadata)
        if enum_values is not None:
            return _string_schema(description, enum_values=enum_values), allows_none
        if len(non_none_args) == 1:
            schema, nested_nullable = _schema_for_annotation(
                non_none_args[0],
                description=description,
                dataclass_name=dataclass_name,
                field_name=field_name,
                metadata=metadata,
            )
            return schema, allows_none or nested_nullable
        raise ContractFunctionSchemaError(
            f"{dataclass_name}.{field_name} has unsupported annotation: {annotation!r}"
        )
    enum_values = _enum_values_for_annotation(annotation, metadata)
    if enum_values is not None:
        return _string_schema(description, enum_values=enum_values), False
    if annotation is str:
        return _string_schema(description), False
    if annotation is int:
        return _integer_schema(description, metadata=metadata), False
    if annotation is bool:
        return {"type": "boolean", "description": description}, False
    if annotation is float:
        return {"type": "number", "description": description}, False
    origin = get_origin(annotation)
    if origin in {list, tuple}:
        args = get_args(annotation)
        if origin is tuple:
            if len(args) != 2 or args[1] is not Ellipsis:
                raise ContractFunctionSchemaError(
                    f"{dataclass_name}.{field_name} has unsupported tuple annotation: {annotation!r}"
                )
            item_annotation = args[0]
        else:
            if len(args) != 1:
                raise ContractFunctionSchemaError(
                    f"{dataclass_name}.{field_name} has unsupported list annotation: {annotation!r}"
                )
            item_annotation = args[0]
        items_schema, item_nullable = _schema_for_annotation(
            item_annotation,
            description=description,
            dataclass_name=dataclass_name,
            field_name=field_name,
            metadata={},
        )
        if item_nullable:
            items_schema = _nullable_schema(items_schema)
        return {
            "type": "array",
            "description": description,
            "items": items_schema,
        }, False
    if isinstance(annotation, type) and is_dataclass(annotation):
        schema = _object_schema_for_dataclass(annotation)
        schema["description"] = description
        return schema, False
    raise ContractFunctionSchemaError(
        f"{dataclass_name}.{field_name} has unsupported annotation: {annotation!r}"
    )


def _required_description(payload_type: type[object], dataclass_field: Field[Any]) -> str:
    description = str(dataclass_field.metadata.get(SCHEMA_DESCRIPTION, "") or "").strip()
    if not description:
        raise ContractFunctionSchemaError(
            f"{payload_type.__name__}.{dataclass_field.name} is missing schema description metadata"
        )
    return description


def _is_semantically_required(dataclass_field: Field[Any]) -> bool:
    if dataclass_field.metadata.get(SCHEMA_SEMANTIC_REQUIRED):
        return True
    return dataclass_field.default is MISSING and dataclass_field.default_factory is MISSING


def _enum_values_for_annotation(annotation: object, metadata: Any) -> tuple[str, ...] | None:
    metadata_values = metadata.get(SCHEMA_ENUM_VALUES) if metadata is not None else None
    if metadata_values:
        return tuple(str(value) for value in metadata_values)
    origin = get_origin(annotation)
    if origin is types.NoneType:
        return None
    if origin is not None and origin.__qualname__ == "Literal":
        return tuple(str(value) for value in get_args(annotation))
    if isinstance(annotation, type) and issubclass(annotation, StrEnum):
        return tuple(member.value for member in annotation)
    union_args = _union_args(annotation)
    if union_args is None:
        return None
    enum_values: list[str] = []
    for arg in union_args:
        if arg is str or arg is type(None):
            continue
        values = _enum_values_for_annotation(arg, {})
        if values is None:
            return None
        enum_values.extend(values)
    if not enum_values:
        return None
    deduped: list[str] = []
    seen: set[str] = set()
    for value in enum_values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return tuple(deduped)


def _union_args(annotation: object) -> tuple[object, ...] | None:
    origin = get_origin(annotation)
    if origin in {types.UnionType, getattr(types, "UnionType", object)}:
        return get_args(annotation)
    if origin is None and isinstance(annotation, types.UnionType):
        return get_args(annotation)
    if origin is None:
        return None
    if str(origin) == "typing.Union":
        return get_args(annotation)
    return None


def _string_schema(
    description: str,
    *,
    enum_values: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    schema: dict[str, Any] = {
        "type": "string",
        "description": description,
    }
    if enum_values is not None:
        schema["enum"] = list(enum_values)
    return schema


def _integer_schema(description: str, *, metadata: Any) -> dict[str, Any]:
    schema: dict[str, Any] = {
        "type": "integer",
        "description": description,
    }
    minimum = metadata.get(SCHEMA_MINIMUM) if metadata is not None else None
    if minimum is not None:
        schema["minimum"] = int(minimum)
    return schema


def _nullable_schema(schema: dict[str, Any]) -> dict[str, Any]:
    nullable = dict(schema)
    schema_type = nullable.get("type")
    if isinstance(schema_type, str):
        nullable["type"] = [schema_type, "null"]
    elif isinstance(schema_type, list) and "null" not in schema_type:
        nullable["type"] = [*schema_type, "null"]
    if "enum" in nullable and None not in nullable["enum"]:
        nullable["enum"] = [*nullable["enum"], None]
    return nullable


__all__ = [
    "ContractFunctionSchemaError",
    "provider_parameters_schema_for_type",
]
