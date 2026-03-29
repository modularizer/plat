"""
plat CLI runtime — shared arg parsing, formatters, and dispatch.
"""

import json
import os
import shutil
import sys
import urllib.parse

from .logging import get_logger

logger = get_logger("plat.cli")


def parse_args(argv):
    """Parse --key=value args into a dict with type coercion."""
    result = {}
    fmt = "json"
    for arg in argv:
        if not arg.startswith("--"):
            continue
        if "=" in arg:
            key, val = arg[2:].split("=", 1)
        else:
            key, val = arg[2:], True

        if key == "format":
            fmt = val if isinstance(val, str) else "json"
            continue

        key = key.replace("-", "_")

        if val is True:
            pass
        elif val.lower() == "true":
            val = True
        elif val.lower() == "false":
            val = False
        else:
            try:
                val = int(val)
            except ValueError:
                try:
                    val = float(val)
                except ValueError:
                    if val.startswith("{") or val.startswith("["):
                        try:
                            val = json.loads(val)
                        except json.JSONDecodeError:
                            pass

        result[key] = val
    return result, fmt


# ── formatters ───────────────────────────────────────────────

def format_json(data):
    return json.dumps(data, indent=2, default=str)


def format_yaml(data, indent=0):
    pad = "  " * indent
    if data is None:
        return "null"
    if isinstance(data, bool):
        return "true" if data else "false"
    if isinstance(data, (int, float)):
        return str(data)
    if isinstance(data, str):
        return data
    if isinstance(data, list):
        if not data:
            return "[]"
        lines = []
        for item in data:
            if isinstance(item, dict):
                entries = list(item.items())
                first_k, first_v = entries[0]
                s = f"{pad}- {first_k}: {format_yaml(first_v, indent + 2)}"
                for k, v in entries[1:]:
                    s += f"\n{pad}  {k}: {format_yaml(v, indent + 2)}"
                lines.append(s)
            else:
                lines.append(f"{pad}- {format_yaml(item, indent + 1)}")
        return "\n".join(lines)
    if isinstance(data, dict):
        if not data:
            return "{}"
        lines = []
        for k, v in data.items():
            if isinstance(v, (dict, list)):
                lines.append(f"{pad}{k}:\n{format_yaml(v, indent + 1)}")
            else:
                lines.append(f"{pad}{k}: {format_yaml(v, indent)}")
        return "\n".join(lines)
    return str(data)


def format_human(data, indent=0):
    pad = "  " * indent
    if data is None:
        return f"{pad}\u2014"
    if not isinstance(data, (dict, list)):
        return f"{pad}{data}"
    if isinstance(data, list):
        if not data:
            return f"{pad}(empty)"
        lines = []
        for i, item in enumerate(data, 1):
            lines.append(f"{pad}{i}. {format_human(item, 0).lstrip()}")
        return "\n".join(lines)
    lines = []
    for k, v in data.items():
        if isinstance(v, (dict, list)):
            lines.append(f"{pad}{k}:\n{format_human(v, indent + 1)}")
        else:
            lines.append(f"{pad}{k}: {v if v is not None else '\u2014'}")
    return "\n".join(lines)


def format_table(data):
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        arr = next((v for v in data.values() if isinstance(v, list)), None)
        rows = arr if arr is not None else [data]
    else:
        return str(data)

    if not rows:
        return "(empty)"
    if not isinstance(rows[0], dict):
        return "\n".join(str(r) for r in rows)

    flat_rows = []
    for row in rows:
        flat = {}
        for k, v in row.items():
            flat[k] = json.dumps(v, default=str) if isinstance(v, (dict, list)) else str(v if v is not None else "")
        flat_rows.append(flat)

    cols = list(dict.fromkeys(k for row in flat_rows for k in row))
    term_width = shutil.get_terminal_size().columns

    widths = {}
    for col in cols:
        widths[col] = len(col)
        for row in flat_rows:
            widths[col] = max(widths[col], len(row.get(col, "")))

    borders = 1 + len(cols) * 3
    total = borders + sum(widths.values())
    while total > term_width:
        widest = max(cols, key=lambda c: widths[c])
        if widths[widest] <= 4:
            break
        widths[widest] = max(4, widths[widest] - 1)
        total = borders + sum(widths.values())

    def trunc(s, w):
        return s[:w - 1] + "\u2026" if len(s) > w else s

    def hline(left, mid, right):
        return left + mid.join("\u2500" * (widths[c] + 2) for c in cols) + right

    def data_row(row):
        return "\u2502" + "\u2502".join(
            " " + trunc(row.get(c, ""), widths[c]).ljust(widths[c]) + " " for c in cols
        ) + "\u2502"

    lines = []
    lines.append(hline("\u250c", "\u252c", "\u2510"))
    lines.append("\u2502" + "\u2502".join(
        " " + trunc(c, widths[c]).ljust(widths[c]) + " " for c in cols
    ) + "\u2502")
    lines.append(hline("\u251c", "\u253c", "\u2524"))
    for row in flat_rows:
        lines.append(data_row(row))
    lines.append(hline("\u2514", "\u2534", "\u2518"))
    return "\n".join(lines)


def format_csv(data):
    import csv
    import io

    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        arr = next((v for v in data.values() if isinstance(v, list)), None)
        rows = arr if arr is not None else [data]
    else:
        return str(data)

    if not rows:
        return ""
    if not isinstance(rows[0], dict):
        return "\n".join(str(r) for r in rows)

    cols = list(dict.fromkeys(k for row in rows for k in row))
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(cols)
    for row in rows:
        writer.writerow(
            json.dumps(row.get(c), default=str) if isinstance(row.get(c), (dict, list))
            else str(row.get(c, "")) if row.get(c) is not None else ""
            for c in cols
        )
    return buf.getvalue().rstrip()


def output(data, fmt):
    if fmt == "yaml":
        logger.info("%s", format_yaml(data))
    elif fmt == "table":
        logger.info("%s", format_table(data))
    elif fmt == "csv":
        logger.info("%s", format_csv(data))
    elif fmt == "human":
        logger.info("%s", format_human(data))
    else:
        logger.info("%s", format_json(data))


def run_cli(api_client_class, spec_path="openapi.json"):
    """Generic CLI entry point. Pass in the ApiClient class and spec path."""
    import pathlib
    spec_file = pathlib.Path(__file__).parent / spec_path
    with open(spec_file) as f:
        spec = json.load(f)

    # extract commands from spec
    commands = {}
    aliases = {}
    command_meta = []
    for url_path, methods in spec.get("paths", {}).items():
        for http_method, op in methods.items():
            op_id = op.get("operationId")
            if not op_id:
                continue
            params = []
            for p in op.get("parameters", []):
                params.append({"name": p["name"], "required": p.get("required", False)})
            body_schema = (op.get("requestBody", {}).get("content", {})
                           .get("application/json", {}).get("schema", {}))
            req_set = set(body_schema.get("required", []))
            for name in body_schema.get("properties", {}):
                params.append({"name": name, "required": name in req_set})

            snake = _to_snake_case(op_id)
            commands[snake] = {"method": http_method.upper(), "path": url_path, "params": params, "summary": op.get("summary", "")}
            if snake != op_id:
                aliases[op_id] = snake
            command_meta.append((snake, params, op.get("summary", "")))

    if len(sys.argv) < 2 or sys.argv[1] in ("help", "--help", "-h"):
        title = spec.get("info", {}).get("title", "API")
        logger.info("%s", f"{title} CLI\n")
        logger.info("%s", "Usage: <command> [--key=value ...] [--format=json|yaml|table|csv|human]\n")
        logger.info("%s", "Commands:")
        for name, params, summary in command_meta:
            ps = " ".join(
                f"--{p['name']}" if p["required"] else f"[--{p['name']}]"
                for p in params
            )
            desc = f"  \u2014 {summary}" if summary else ""
            logger.info("%s", f"  {name:<30} {ps}{desc}")
        logger.info("%s", "\nEnvironment Variables:")
        logger.info("%s", "  API_URL        Base URL (default: from spec or http://localhost:3000)")
        logger.info("%s", "  API_TOKEN      Bearer auth token")
        sys.exit(0)

    command = sys.argv[1]
    command = aliases.get(command, command)

    if command not in commands:
        logger.error("Unknown command: %s. Run with --help for available commands.", command)
        sys.exit(1)

    base_url = os.environ.get("API_URL", spec.get("servers", [{}])[0].get("url", "http://localhost:3000"))
    client = api_client_class(base_url)
    kwargs, fmt = parse_args(sys.argv[2:])

    try:
        method = getattr(client, command)
        result = method(**kwargs)
        output(result, fmt)
    except Exception as e:
        logger.error("%s", str(e))
        sys.exit(1)


def _to_snake_case(s):
    import re
    s = re.sub(r"[^A-Za-z0-9]+", "_", s)
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s)
    s = re.sub(r"([A-Z])([A-Z][a-z])", r"\1_\2", s)
    return s.strip("_").lower()


def extract_spec_commands(spec):
    commands = {}
    aliases = {}
    command_meta = []
    for url_path, methods in spec.get("paths", {}).items():
        for http_method, op in methods.items():
            op_id = op.get("operationId")
            if not op_id:
                continue
            params = []
            for p in op.get("parameters", []):
                params.append({"name": p["name"], "required": p.get("required", False), "in": p.get("in")})
            body_schema = (op.get("requestBody", {}).get("content", {})
                           .get("application/json", {}).get("schema", {}))
            req_set = set(body_schema.get("required", []))
            for name in body_schema.get("properties", {}):
                params.append({"name": name, "required": name in req_set, "in": "body"})

            snake = _to_snake_case(op_id)
            commands[snake] = {
                "method": http_method.upper(),
                "path": url_path,
                "params": params,
                "summary": op.get("summary", ""),
                "requestBody": op.get("requestBody", {}),
            }
            if snake != op_id:
                aliases[op_id] = snake
            command_meta.append((snake, params, op.get("summary", "")))
    return commands, aliases, command_meta


def _replace_path_params(path, values):
    for key, value in values.items():
        path = path.replace("{" + key + "}", urllib.parse.quote(str(value), safe=""))
    return path


def request_spec_command(spec, command, input_data, base_url=None):
    import httpx

    base_url = base_url or os.environ.get("API_URL") or spec.get("servers", [{}])[0].get("url", "http://localhost:3000")
    path_params = [p["name"] for p in command.get("params", []) if p.get("in") == "path"]
    query_params = [p["name"] for p in command.get("params", []) if p.get("in") == "query"]
    body_params = [p["name"] for p in command.get("params", []) if p.get("in") == "body"]

    path_values = {name: input_data[name] for name in path_params if name in input_data}
    url = base_url.rstrip("/") + _replace_path_params(command["path"], path_values)
    query_values = {name: input_data[name] for name in query_params if name in input_data}
    body_values = {name: input_data[name] for name in body_params if name in input_data}

    headers = {}
    token = os.environ.get("API_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    with httpx.Client(timeout=30.0, headers=headers) as client:
        response = client.request(
            command["method"],
            url,
            params={k: v for k, v in query_values.items() if v is not None} or None,
            json={k: v for k, v in body_values.items() if v is not None} or None,
        )
        response.raise_for_status()
        if not response.content:
            return None
        content_type = response.headers.get("content-type", "")
        if "json" in content_type:
            return response.json()
        return response.text


def run_spec_cli(spec, argv=None, base_url=None):
    commands, aliases, command_meta = extract_spec_commands(spec)
    argv = argv or sys.argv[1:]

    if not argv or argv[0] in ("help", "--help", "-h"):
        title = spec.get("info", {}).get("title", "API")
        logger.info("%s", f"{title} CLI\n")
        logger.info("%s", "Usage: <command> [--key=value ...] [--format=json|yaml|table|csv|human]\n")
        logger.info("%s", "Commands:")
        for name, params, summary in command_meta:
            ps = " ".join(
                f"--{p['name']}" if p["required"] else f"[--{p['name']}]"
                for p in params
            )
            desc = f"  — {summary}" if summary else ""
            logger.info("%s", f"  {name:<30} {ps}{desc}")
        logger.info("%s", "\nEnvironment Variables:")
        logger.info("%s", "  API_URL        Base URL (default: from spec or http://localhost:3000)")
        logger.info("%s", "  API_TOKEN      Bearer auth token")
        return

    command_name = aliases.get(argv[0], argv[0])
    if command_name not in commands:
        logger.error("Unknown command: %s. Run with --help for available commands.", argv[0])
        sys.exit(1)

    kwargs, fmt = parse_args(argv[1:])
    try:
        result = request_spec_command(spec, commands[command_name], kwargs, base_url=base_url)
        output(result, fmt)
    except Exception as exc:
        logger.error("%s", str(exc))
        sys.exit(1)
