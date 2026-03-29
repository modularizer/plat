from __future__ import annotations

import json
import re
from collections import OrderedDict
from typing import Any


HTTP_METHODS = {"get", "post", "put", "patch", "delete", "options", "head"}


def generate_python_client(spec: dict[str, Any], source: str, base_url: str | None) -> str:
    default_base_url = base_url or spec.get("servers", [{}])[0].get("url", "http://localhost:3000")
    ctx = _CodegenContext(spec)
    operations = _resolve_operations(_extract_operations(spec))
    for operation in operations:
        ctx.ensure_operation_models(operation)

    lines: list[str] = [
        '"""',
        "Auto-generated Python API client.",
        f"Source: {source}",
        "DO NOT EDIT MANUALLY.",
        '"""',
        "",
        "from __future__ import annotations",
        "",
        "import json",
        "from datetime import date, datetime",
        "from typing import Any, Literal",
        "",
        "from pydantic import BaseModel, ConfigDict, Field, RootModel",
        "from plat import OpenAPIAsyncClient, OpenAPIPromiseClient, OpenAPISyncClient, PLATPromise",
        "",
        f"OPENAPI_SPEC = json.loads(r'''{json.dumps(spec)}''')",
        f"DEFAULT_BASE_URL = {json.dumps(default_base_url)}",
        "",
    ]

    if ctx.model_definitions:
        lines.extend(["# Models", ""])
        for definition in ctx.model_definitions.values():
            lines.extend(definition)
            lines.append("")

    lines.extend(
        [
            "class ApiClient(OpenAPISyncClient):",
            "    def __init__(self, base_url: str = DEFAULT_BASE_URL, **kwargs: Any):",
            "        super().__init__(OPENAPI_SPEC, base_url=base_url, **kwargs)",
            "",
        ]
    )
    if not operations:
        lines.append("    pass")
    for operation in operations:
        lines.extend(_emit_client_method(operation, async_mode=False))
        lines.append("")

    lines.extend(
        [
            "",
            "class AsyncApiClient(OpenAPIAsyncClient):",
            "    def __init__(self, base_url: str = DEFAULT_BASE_URL, **kwargs: Any):",
            "        super().__init__(OPENAPI_SPEC, base_url=base_url, **kwargs)",
            "",
        ]
    )
    if not operations:
        lines.append("    pass")
    for operation in operations:
        lines.extend(_emit_client_method(operation, async_mode=True))
        lines.append("")

    lines.extend(
        [
            "",
            "class PromiseApiClient(OpenAPIPromiseClient):",
            "    def __init__(self, base_url: str = DEFAULT_BASE_URL, **kwargs: Any):",
            "        super().__init__(OPENAPI_SPEC, base_url=base_url, **kwargs)",
            "",
        ]
    )
    if not operations:
        lines.append("    pass")
    for operation in operations:
        lines.extend(_emit_client_method(operation, async_mode=False, promise_mode=True))
        lines.append("")

    lines.extend(
        [
            "",
            "def create_client(base_url: str = DEFAULT_BASE_URL, **kwargs: Any) -> ApiClient:",
            "    return ApiClient(base_url=base_url, **kwargs)",
            "",
            "def create_async_client(base_url: str = DEFAULT_BASE_URL, **kwargs: Any) -> AsyncApiClient:",
            "    return AsyncApiClient(base_url=base_url, **kwargs)",
            "",
            "def create_promise_client(base_url: str = DEFAULT_BASE_URL, **kwargs: Any) -> PromiseApiClient:",
            "    return PromiseApiClient(base_url=base_url, **kwargs)",
            "",
        ]
    )

    return "\n".join(lines).rstrip() + "\n"


class _CodegenContext:
    def __init__(self, spec: dict[str, Any]):
        self.spec = spec
        self.schemas = ((spec.get("components") or {}).get("schemas") or {})
        self.model_definitions: "OrderedDict[str, list[str]]" = OrderedDict()
        self.generated_schema_models: dict[str, str] = {}
        self.operation_input_models: dict[str, str] = {}
        self.operation_output_models: dict[str, str] = {}

    def ensure_schema_model(self, name: str, schema: dict[str, Any]) -> str:
        if name in self.generated_schema_models:
            return self.generated_schema_models[name]
        self.generated_schema_models[name] = name
        self.model_definitions[name] = _emit_model_definition(name, schema, self)
        return name

    def ensure_operation_models(self, operation: dict[str, Any]) -> None:
        op_key = operation["resolvedMethodName"]
        input_name = operation["inputModelName"]
        output_name = operation["outputModelName"]
        self.operation_input_models[op_key] = input_name
        self.operation_output_models[op_key] = output_name
        self.model_definitions.setdefault(input_name, _emit_operation_input_model(input_name, operation, self))
        self.model_definitions.setdefault(output_name, _emit_operation_output_model(output_name, operation, self))


def _extract_operations(spec: dict[str, Any]) -> list[dict[str, Any]]:
    operations: list[dict[str, Any]] = []
    for path, path_item in (spec.get("paths") or {}).items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method.lower() not in HTTP_METHODS or not isinstance(operation, dict) or not operation.get("operationId"):
                continue
            operations.append(
                {
                    "operationId": operation["operationId"],
                    "method": method.upper(),
                    "path": path,
                    "parameters": list(operation.get("parameters") or []),
                    "requestBodySchema": _extract_json_schema((operation.get("requestBody") or {}).get("content")),
                    "responseSchema": _extract_response_schema(operation),
                }
            )
    return operations


def _resolve_operations(operations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    resolved: list[dict[str, Any]] = []
    used_method_names: set[str] = set()
    used_alias_names: set[str] = set()
    used_model_names: set[str] = set()

    for operation in operations:
        base_method_name = _to_snake_case(str(operation["operationId"])) or _to_snake_case(f'{operation["method"]}_{operation["path"]}')
        resolved_method_name = _make_unique_name(
            _sanitize_identifier(base_method_name),
            used_method_names,
            fallback=_sanitize_identifier(_method_path_suffix(operation["method"], operation["path"])),
        )
        used_method_names.add(resolved_method_name)

        alias_candidate = str(operation["operationId"])
        resolved_alias_name = None
        if _is_valid_python_identifier(alias_candidate):
            alias_candidate = _sanitize_identifier(alias_candidate)
            if alias_candidate not in used_method_names and alias_candidate not in used_alias_names and alias_candidate != resolved_method_name:
                resolved_alias_name = alias_candidate
                used_alias_names.add(alias_candidate)

        base_model_name = _pascal_case(str(operation["operationId"])) or _pascal_case(_method_path_suffix(operation["method"], operation["path"]))
        input_model_name = _make_unique_name(f"{base_model_name}Input", used_model_names, fallback=f"{_pascal_case(_method_path_suffix(operation['method'], operation['path']))}Input")
        used_model_names.add(input_model_name)
        output_model_name = _make_unique_name(f"{base_model_name}Output", used_model_names, fallback=f"{_pascal_case(_method_path_suffix(operation['method'], operation['path']))}Output")
        used_model_names.add(output_model_name)

        resolved.append(
            {
                **operation,
                "resolvedMethodName": resolved_method_name,
                "resolvedAliasName": resolved_alias_name,
                "inputModelName": input_model_name,
                "outputModelName": output_model_name,
            }
        )
    return resolved


def _extract_response_schema(operation: dict[str, Any]) -> dict[str, Any] | None:
    responses = operation.get("responses") or {}
    for status_code in ("200", "201", "202", "203", "204", "default"):
        response = responses.get(status_code)
        if not isinstance(response, dict):
            continue
        schema = _extract_json_schema(response.get("content"))
        if schema:
            return schema
    return None


def _extract_json_schema(content: Any) -> dict[str, Any] | None:
    if not isinstance(content, dict):
        return None
    application_json = content.get("application/json") or {}
    schema = application_json.get("schema")
    return schema if isinstance(schema, dict) else None


def _emit_client_method(operation: dict[str, Any], *, async_mode: bool, promise_mode: bool = False) -> list[str]:
    op_id = operation["operationId"]
    snake = operation["resolvedMethodName"]
    input_model = operation["inputModelName"]
    output_model = operation["outputModelName"]
    def_prefix = "async def" if async_mode else "def"
    await_prefix = "await " if async_mode else ""
    return_type = f"PLATPromise[{output_model}]" if promise_mode else output_model
    call_target = f'self.call_typed_route("{operation["method"]}", "{operation["path"]}", payload, {output_model})'
    if async_mode:
        call_target = f"await {call_target}"
    lines = [
        f"    {def_prefix} {snake}(self, input: {input_model} | dict[str, Any] | None = None, /, **kwargs: Any) -> {return_type}:",
        f'        """{operation["method"]} {operation["path"]}"""',
        f"        payload = input if input is not None else ({input_model}(**kwargs) if kwargs else None)",
        f"        return {call_target}",
        "",
    ]
    alias_name = operation.get("resolvedAliasName")
    if alias_name:
        lines.extend(
            [
                f"    {def_prefix} {alias_name}(self, input: {input_model} | dict[str, Any] | None = None, /, **kwargs: Any) -> {return_type}:",
                f"        return {await_prefix}self.{snake}(input, **kwargs)",
            ]
        )
    return lines


def _emit_operation_input_model(name: str, operation: dict[str, Any], ctx: _CodegenContext) -> list[str]:
    fields: list[tuple[str, str, bool, str | None]] = []
    for parameter in operation["parameters"]:
        if not isinstance(parameter, dict):
            continue
        schema = parameter.get("schema") or {}
        alias = parameter.get("name")
        field_name = _to_snake_case(alias)
        field_type = _schema_to_type(schema, ctx, f"{name}{_pascal_case(str(alias))}", nullable=not parameter.get("required", False))
        fields.append((field_name, field_type, bool(parameter.get("required", False)), alias))

    body_schema = operation.get("requestBodySchema")
    if isinstance(body_schema, dict):
        if body_schema.get("type") == "object" and isinstance(body_schema.get("properties"), dict):
            required = set(body_schema.get("required") or [])
            for prop_name, prop_schema in body_schema["properties"].items():
                field_name = _to_snake_case(prop_name)
                field_type = _schema_to_type(
                    prop_schema,
                    ctx,
                    f"{name}{_pascal_case(str(prop_name))}",
                    nullable=prop_name not in required,
                )
                fields.append((field_name, field_type, prop_name in required, prop_name))
        else:
            fields.append(("body", _schema_to_type(body_schema, ctx, f"{name}Body", nullable=True), False, None))

    return _emit_base_model(name, fields)


def _emit_operation_output_model(name: str, operation: dict[str, Any], ctx: _CodegenContext) -> list[str]:
    schema = operation.get("responseSchema")
    if not isinstance(schema, dict):
        return _emit_root_model(name, "Any")
    if schema.get("type") == "object" and isinstance(schema.get("properties"), dict):
        required = set(schema.get("required") or [])
        fields = []
        for prop_name, prop_schema in schema["properties"].items():
            fields.append(
                (
                    _to_snake_case(prop_name),
                    _schema_to_type(prop_schema, ctx, f"{name}{_pascal_case(str(prop_name))}", nullable=prop_name not in required),
                    prop_name in required,
                    prop_name,
                )
            )
        return _emit_base_model(name, fields)
    return _emit_root_model(name, _schema_to_type(schema, ctx, name, nullable=schema.get("nullable", False)))


def _emit_model_definition(name: str, schema: dict[str, Any], ctx: _CodegenContext) -> list[str]:
    if schema.get("type") == "object" and isinstance(schema.get("properties"), dict):
        required = set(schema.get("required") or [])
        fields = []
        for prop_name, prop_schema in schema["properties"].items():
            fields.append(
                (
                    _to_snake_case(prop_name),
                    _schema_to_type(prop_schema, ctx, f"{name}{_pascal_case(str(prop_name))}", nullable=prop_name not in required),
                    prop_name in required,
                    prop_name,
                )
            )
        return _emit_base_model(name, fields)
    return _emit_root_model(name, _schema_to_type(schema, ctx, name, nullable=schema.get("nullable", False)))


def _emit_base_model(name: str, fields: list[tuple[str, str, bool, str | None]]) -> list[str]:
    lines = [f"class {name}(BaseModel):", "    model_config = ConfigDict(populate_by_name=True, extra='allow')"]
    if not fields:
        lines.append("    pass")
        return lines

    required_fields = [field for field in fields if field[2]]
    optional_fields = [field for field in fields if not field[2]]
    for field_name, field_type, is_required, alias in required_fields + optional_fields:
        alias_expr = f', alias="{alias}"' if alias and alias != field_name else ""
        default = "Field(...%s)" % alias_expr if is_required else "Field(None%s)" % alias_expr
        lines.append(f"    {field_name}: {field_type} = {default}")
    return lines


def _emit_root_model(name: str, inner_type: str) -> list[str]:
    return [f"class {name}(RootModel[{inner_type}]):", "    pass"]


def _schema_to_type(schema: Any, ctx: _CodegenContext, model_name: str, *, nullable: bool = False) -> str:
    if not isinstance(schema, dict):
        return _nullable("Any", nullable)

    if "$ref" in schema:
        ref_name = str(schema["$ref"]).split("/")[-1]
        referenced = ctx.schemas.get(ref_name)
        if isinstance(referenced, dict):
            ctx.ensure_schema_model(ref_name, referenced)
        return _nullable(ref_name, nullable or bool(schema.get("nullable")))

    if schema.get("enum"):
        values = ", ".join(_literal_value(value) for value in schema["enum"])
        return _nullable(f"Literal[{values}]", nullable or bool(schema.get("nullable")))

    if schema.get("oneOf") or schema.get("anyOf"):
        variants = schema.get("oneOf") or schema.get("anyOf") or []
        variant_types = [_schema_to_type(item, ctx, f"{model_name}Option{index}", nullable=False) for index, item in enumerate(variants, start=1)]
        return _nullable(" | ".join(variant_types) or "Any", nullable or bool(schema.get("nullable")))

    schema_type = schema.get("type")
    schema_format = schema.get("format")
    if schema_type == "string":
        if schema_format == "date-time":
            return _nullable("datetime", nullable or bool(schema.get("nullable")))
        if schema_format == "date":
            return _nullable("date", nullable or bool(schema.get("nullable")))
        return _nullable("str", nullable or bool(schema.get("nullable")))
    if schema_type == "integer":
        return _nullable("int", nullable or bool(schema.get("nullable")))
    if schema_type == "number":
        return _nullable("float", nullable or bool(schema.get("nullable")))
    if schema_type == "boolean":
        return _nullable("bool", nullable or bool(schema.get("nullable")))
    if schema_type == "array":
        item_type = _schema_to_type(schema.get("items"), ctx, f"{model_name}Item", nullable=False)
        return _nullable(f"list[{item_type}]", nullable or bool(schema.get("nullable")))
    if schema_type == "object" or schema.get("properties"):
        if schema.get("properties"):
            inline_name = model_name
            ctx.model_definitions.setdefault(inline_name, _emit_model_definition(inline_name, schema, ctx))
            return _nullable(inline_name, nullable or bool(schema.get("nullable")))
        additional = schema.get("additionalProperties")
        if isinstance(additional, dict):
            value_type = _schema_to_type(additional, ctx, f"{model_name}Value", nullable=False)
            return _nullable(f"dict[str, {value_type}]", nullable or bool(schema.get("nullable")))
        return _nullable("dict[str, Any]", nullable or bool(schema.get("nullable")))
    return _nullable("Any", nullable or bool(schema.get("nullable")))


def _nullable(type_name: str, nullable: bool) -> str:
    return f"{type_name} | None" if nullable else type_name


def _literal_value(value: Any) -> str:
    if isinstance(value, str):
        return json.dumps(value)
    return repr(value)


def _pascal_case(value: str) -> str:
    chunks = re.split(r"[^A-Za-z0-9]+", value)
    if len(chunks) == 1:
        value = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", value)
        chunks = value.split()
    return "".join(chunk[:1].upper() + chunk[1:] for chunk in chunks if chunk)


def _to_snake_case(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9]+", "_", value)
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value)
    value = re.sub(r"([A-Z])([A-Z][a-z])", r"\1_\2", value)
    return value.strip("_").lower()


def _method_path_suffix(method: str, path: str) -> str:
    path_suffix = path.replace("{", "_").replace("}", "").replace("/", "_")
    return f"{method}_{path_suffix}"


def _sanitize_identifier(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9_]", "_", value)
    value = re.sub(r"_+", "_", value).strip("_")
    if not value:
        return "operation"
    if value[0].isdigit():
        value = f"op_{value}"
    return value


def _is_valid_python_identifier(value: str) -> bool:
    return value.isidentifier() and not value.startswith("_")


def _make_unique_name(base: str, used: set[str], fallback: str) -> str:
    candidate = base or fallback
    if candidate not in used:
        return candidate
    suffix = 2
    while f"{candidate}_{suffix}" in used:
        suffix += 1
    return f"{candidate}_{suffix}"
