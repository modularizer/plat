from __future__ import annotations

from typing import Any, Mapping


ToolDefinition = dict[str, Any]


def to_anthropic_format(tool: ToolDefinition) -> dict[str, Any]:
    return {
        "name": tool["name"],
        "description": tool["description"],
        "input_schema": tool["input_schema"],
    }


def to_openai_format(tool: ToolDefinition) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool["description"],
            "parameters": {
                "type": "object",
                "properties": tool["input_schema"]["properties"],
                "required": tool["input_schema"]["required"],
            },
        },
    }


def format_tool(tool: ToolDefinition, fmt: str = "schema") -> dict[str, Any]:
    if fmt == "claude":
        return to_anthropic_format(tool)
    if fmt == "openai":
        return to_openai_format(tool)
    return tool


def build_input_schema_from_openapi_operation(operation: Mapping[str, Any]) -> dict[str, Any]:
    properties: dict[str, Any] = {}
    required: list[str] = []

    for param in operation.get("parameters", []) or []:
        if not isinstance(param, Mapping):
            continue
        name = param.get("name")
        schema = param.get("schema")
        if not isinstance(name, str) or not isinstance(schema, Mapping):
            continue
        properties[name] = dict(schema)
        if param.get("description"):
            properties[name]["description"] = param["description"]
        if param.get("required") and name not in required:
            required.append(name)

    request_body = operation.get("requestBody") or {}
    content = request_body.get("content") if isinstance(request_body, Mapping) else {}
    json_body = content.get("application/json") if isinstance(content, Mapping) else {}
    body_schema = json_body.get("schema") if isinstance(json_body, Mapping) else None
    if isinstance(body_schema, Mapping) and (
        body_schema.get("type") == "object" or isinstance(body_schema.get("properties"), Mapping)
    ):
        properties.update(dict(body_schema.get("properties") or {}))
        for name in body_schema.get("required", []) or []:
            if isinstance(name, str) and name not in required:
                required.append(name)

    return {
        "type": "object",
        "properties": properties,
        "required": required,
    }


def build_response_schema_from_openapi_operation(operation: Mapping[str, Any]) -> dict[str, Any] | None:
    responses = operation.get("responses")
    if not isinstance(responses, Mapping):
        return None

    for status in ("200", "201", "202", "default"):
        response = responses.get(status)
        if not isinstance(response, Mapping):
            continue
        content = response.get("content")
        if not isinstance(content, Mapping):
            continue
        json_body = content.get("application/json")
        if not isinstance(json_body, Mapping):
            continue
        schema = json_body.get("schema")
        if isinstance(schema, Mapping):
            return dict(schema)

    for response in responses.values():
        if not isinstance(response, Mapping):
            continue
        content = response.get("content")
        if not isinstance(content, Mapping):
            continue
        json_body = content.get("application/json")
        if not isinstance(json_body, Mapping):
            continue
        schema = json_body.get("schema")
        if isinstance(schema, Mapping):
            return dict(schema)

    return None


def tool_definition_from_openapi_operation(path: str, method: str, operation: Mapping[str, Any]) -> ToolDefinition | None:
    operation_id = operation.get("operationId")
    if not isinstance(operation_id, str) or not operation_id:
        return None

    tags_value = operation.get("tags")
    tags = [tag for tag in tags_value if isinstance(tag, str)] if isinstance(tags_value, list) else None

    return {
        "name": operation_id,
        "summary": operation.get("summary"),
        "description": operation.get("description") or operation.get("summary") or f"{method.upper()} {path}",
        "method": method.upper(),
        "path": path,
        "controller": tags[0] if tags else None,
        "tags": tags,
        "input_schema": build_input_schema_from_openapi_operation(operation),
        "response_schema": build_response_schema_from_openapi_operation(operation),
    }


def extract_tools_from_openapi(spec: Mapping[str, Any]) -> list[ToolDefinition]:
    tools: list[ToolDefinition] = []
    paths = spec.get("paths")
    if not isinstance(paths, Mapping):
        return tools

    for path, path_item in paths.items():
        if not isinstance(path, str) or not isinstance(path_item, Mapping):
            continue
        for method, operation in path_item.items():
            if not isinstance(method, str) or method.lower() not in {"get", "post", "put", "patch", "delete"}:
                continue
            if not isinstance(operation, Mapping):
                continue
            tool = tool_definition_from_openapi_operation(path, method, operation)
            if tool is not None:
                tools.append(tool)

    return tools
