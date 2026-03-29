from __future__ import annotations

import json
import os
import pathlib
import sys
from typing import Any
from urllib.parse import urlparse

from .cli import run_spec_cli
from .logging import get_logger
from .openapi_codegen import generate_python_client as generate_python_typed_client
from .server import create_server

logger = get_logger("plat.cli")


def main() -> None:
    args = sys.argv[1:]
    if not args or args[0] in {"help", "--help", "-h"}:
        print_help()
        return

    command = args[0]
    rest = args[1:]

    if command == "gen":
        run_gen(rest)
        return

    if command == "run":
        run_spec(rest)
        return

    if command == "serve":
        run_serve(rest)
        return

    if command == "init":
        fail("`plat init` is not implemented in the Python package.")

    if command == "env":
        fail("`plat env` is not implemented in the Python package.")

    if command == "jwt":
        fail("`plat jwt` is not implemented in the Python package.")

    fail(f"Unknown command: {command}")


def print_help() -> None:
    logger.info(
        "\n".join(
            [
                "plat - Python CLI",
                "",
                "Usage:",
                "  plat gen openapi [src] [--dst <file>]",
                "  plat gen client [src] [--dst <file>]",
                "  plat gen cli [src] [--dst <file>]",
                "  plat run [src] <command> [--key=value ...]",
                "  plat serve [src] [--port <n>] [--host <host>] [--cors [value]] [--openapi [value]] [--swagger [value]] [--redoc [value]]",
                "",
                "Notes:",
                "  Python supports `gen openapi`, `gen client`, `gen cli`, `run`, and `serve`.",
            ]
        )
    )


def run_gen(args: list[str]) -> None:
    if not args:
        fail("Expected a subcommand after `plat gen`.")

    subcommand = args[0]
    rest = args[1:]

    src = get_option(rest, "--src") or first_positional(rest, {"--src", "--dst", "--cors", "--openapi", "--swagger", "--redoc"})
    dst = get_option(rest, "--dst")

    if subcommand == "openapi":
        out_path = pathlib.Path(dst or "openapi.json").resolve()
        spec = generate_openapi_from_source(
            src,
            {
                "cors": parse_cors_flag(rest),
                "openapi": parse_toggle_or_path_flag(rest, "--openapi"),
                "swagger": parse_toggle_or_path_flag(rest, "--swagger"),
                "redoc": parse_toggle_or_path_flag(rest, "--redoc"),
            },
        )
        write_openapi_spec(out_path, spec)
        logger.info("Generated %s", out_path)
        return

    if subcommand == "client":
        spec, source, base_url = load_spec(src)
        out_path = pathlib.Path(dst or "client.ts").resolve()
        write_text(out_path, generate_client(spec, source, base_url, out_path.suffix.lower()))
        logger.info("Generated %s", out_path)
        return

    if subcommand == "cli":
        spec, source, base_url = load_spec(src)
        out_path = pathlib.Path(dst or "cli.ts").resolve()
        write_text(out_path, generate_cli(spec, source, base_url, out_path.suffix.lower()))
        out_path.chmod(0o755)
        logger.info("Generated %s", out_path)
        return

    fail(f"Unknown gen target: {subcommand}")


def run_spec(args: list[str]) -> None:
    explicit_src = get_option(args, "--src")
    positional_src = None if explicit_src else infer_run_source(args)
    src = explicit_src or positional_src
    passthrough = strip_option(args, "--src")
    if positional_src:
        passthrough = strip_first_positional(passthrough, {"--src"})

    spec, _, base_url = load_spec(src)
    run_spec_cli(spec, argv=passthrough, base_url=base_url)


def run_serve(args: list[str]) -> None:
    src = get_option(args, "--src") or first_positional(args, {"--src", "--port", "--host", "--cors", "--openapi", "--swagger", "--redoc"})
    port = int(get_option(args, "--port") or "3000")
    host = get_option(args, "--host") or "localhost"
    pattern = src or "**/*.api.py"
    options = {
        "port": port,
        "host": host,
        "cors": parse_cors_flag(args),
        "openapi": parse_toggle_or_path_flag(args, "--openapi"),
        "swagger": parse_toggle_or_path_flag(args, "--swagger"),
        "redoc": parse_toggle_or_path_flag(args, "--redoc"),
    }

    try:
        server = create_server(options)
    except ImportError as exc:
        fail(str(exc))
    try:
        server.register_glob(pattern, root=pathlib.Path.cwd())
    except ValueError as exc:
        fail(str(exc))
    server.listen(port=port, host=host)


def generate_openapi_from_source(src: str | None, options: dict[str, Any] | None = None) -> dict[str, Any]:
    pattern = src or "**/*.api.py"
    try:
        server = create_server(options or {})
    except ImportError as exc:
        fail(str(exc))

    try:
        server.register_glob(pattern, root=pathlib.Path.cwd())
    except ValueError as exc:
        fail(str(exc))

    return server.get_app().openapi()


def parse_toggle_or_path_flag(args: list[str], flag: str) -> bool | str | None:
    value = get_option(args, flag)
    if value is not None:
        return coerce_toggle_or_path(value)
    if flag in args:
        return True
    return None


def coerce_toggle_or_path(value: str) -> bool | str:
    lowered = value.lower()
    if lowered in {"true", "yes", "on"}:
        return True
    if lowered in {"false", "no", "off"}:
        return False
    return value


def parse_cors_flag(args: list[str]) -> bool | dict[str, Any] | None:
    value = get_option(args, "--cors")
    if value is None:
        return True if "--cors" in args else None
    lowered = value.lower()
    if lowered in {"true", "yes", "on"}:
        return True
    if lowered in {"false", "no", "off"}:
        return False
    return {"origin": value}


def generate_client(spec: dict[str, Any], source: str, base_url: str | None, suffix: str) -> str:
    if suffix == ".py":
        return generate_python_client(spec, source, base_url)
    return generate_ts_client(spec, source, base_url)


def generate_cli(spec: dict[str, Any], source: str, base_url: str | None, suffix: str) -> str:
    if suffix == ".py":
        return generate_python_cli(spec, source, base_url)
    return generate_ts_cli(spec, source)


def generate_ts_client(spec: dict[str, Any], source: str, base_url: str | None) -> str:
    literal = json.dumps(spec, indent=2)
    default_base_url = json.dumps(base_url or spec.get("servers", [{}])[0].get("url", "http://localhost:3000"))
    return f"""/**
 * Auto-generated OpenAPI client bootstrap.
 * Source: {source}
 * DO NOT EDIT MANUALLY.
 */

import {{ OpenAPIClient, type OpenAPIClientConfig }} from 'plat'
import type {{ OpenAPISpec }} from 'plat'

export const openAPISpec = {literal} as const satisfies OpenAPISpec

export type ApiSpec = typeof openAPISpec
export type ApiClient = OpenAPIClient<ApiSpec>

export const defaultBaseUrl = {default_base_url}

export function createClient(
  baseUrl: string = defaultBaseUrl,
  config?: OpenAPIClientConfig,
): ApiClient {{
  return new OpenAPIClient<ApiSpec>(openAPISpec, {{ ...config, baseUrl }})
}}

export default createClient
"""


def generate_ts_cli(spec: dict[str, Any], source: str) -> str:
    literal = json.dumps(spec, indent=2)
    return f"""#!/usr/bin/env node
/**
 * Auto-generated OpenAPI CLI.
 * Source: {source}
 * DO NOT EDIT MANUALLY.
 */

import {{ runCli }} from 'plat'

const spec = {literal} as const

runCli(spec, process.argv.slice(2))
"""


def generate_python_cli(spec: dict[str, Any], source: str, base_url: str | None) -> str:
    literal = json.dumps(spec)
    default_base_url = json.dumps(base_url or spec.get("servers", [{}])[0].get("url", "http://localhost:3000"))
    return f"""#!/usr/bin/env python3
\"\"\"Auto-generated OpenAPI CLI.
Source: {source}
\"\"\"

import json

from plat.cli import run_spec_cli

SPEC = json.loads(r'''{literal}''')
DEFAULT_BASE_URL = {default_base_url}


if __name__ == "__main__":
    run_spec_cli(SPEC, base_url=DEFAULT_BASE_URL)
"""


def generate_python_client(spec: dict[str, Any], source: str, base_url: str | None) -> str:
    return generate_python_typed_client(spec, source, base_url)


def get_option(args: list[str], flag: str) -> str | None:
    for index, arg in enumerate(args):
        if arg == flag:
            return args[index + 1] if index + 1 < len(args) else None
        if arg.startswith(flag + "="):
            return arg[len(flag) + 1:]
    return None


def first_positional(args: list[str], value_flags: set[str]) -> str | None:
    skip_next = False
    for arg in args:
        if skip_next:
            skip_next = False
            continue
        if arg in value_flags:
            skip_next = True
            continue
        if arg.startswith("--"):
            continue
        return arg
    return None


def strip_option(args: list[str], flag: str) -> list[str]:
    out: list[str] = []
    skip_next = False
    for arg in args:
        if skip_next:
            skip_next = False
            continue
        if arg == flag:
            skip_next = True
            continue
        if arg.startswith(flag + "="):
            continue
        out.append(arg)
    return out


def strip_first_positional(args: list[str], value_flags: set[str]) -> list[str]:
    out: list[str] = []
    removed = False
    skip_next = False
    for arg in args:
        if skip_next:
            out.append(arg)
            skip_next = False
            continue
        if arg in value_flags:
            out.append(arg)
            skip_next = True
            continue
        if not arg.startswith("--") and not removed:
            removed = True
            continue
        out.append(arg)
    return out


def infer_run_source(args: list[str]) -> str | None:
    candidate = first_positional(args, {"--src"})
    if candidate is None:
        return None
    if is_url(candidate) or looks_like_host(candidate):
        return candidate
    if candidate.endswith((".json", ".yaml", ".yml")):
        return candidate
    if "/" in candidate or "\\" in candidate:
        return candidate
    if has_directory_spec(candidate):
        return candidate
    return None


def load_spec(src: str | None) -> tuple[dict[str, Any], str, str | None]:
    if src is None:
        for candidate in ["openapi.json", "openapi.yaml", "openapi.yml"]:
            path_candidate = pathlib.Path.cwd() / candidate
            if path_candidate.exists():
                return parse_spec(path_candidate.read_text(encoding="utf-8"), str(path_candidate)), str(path_candidate), None
        fail("No OpenAPI spec found. Expected openapi.json/openapi.yaml/openapi.yml or pass --src.")

    normalized = normalize_source(src)
    if is_url(normalized):
        import httpx

        for candidate in build_url_candidates(normalized):
            try:
                response = httpx.get(candidate, timeout=30.0)
                if response.status_code >= 400:
                    continue
                return parse_spec(response.text, candidate), candidate, candidate.replace("/openapi.json", "").replace("/openapi.yaml", "").replace("/openapi.yml", "").rstrip("/")
            except Exception:
                continue
        fail(f"Unable to load OpenAPI spec from {normalized}")

    source_path = resolve_local_spec_path(pathlib.Path(normalized))
    if source_path is None:
        fail(f"No OpenAPI spec found at {normalized}")
    return parse_spec(source_path.read_text(encoding="utf-8"), str(source_path)), str(source_path), None


def parse_spec(raw: str, source: str) -> dict[str, Any]:
    if source.endswith((".yaml", ".yml")):
        import yaml
        return yaml.safe_load(raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        import yaml
        return yaml.safe_load(raw)


def normalize_source(src: str) -> str:
    if is_url(src):
        return src
    candidate = pathlib.Path(src).resolve()
    if candidate.exists():
        return str(candidate)
    if looks_like_host(src):
        return f"https://{src}"
    return str(candidate)


def resolve_local_spec_path(path_value: pathlib.Path) -> pathlib.Path | None:
    if path_value.exists() and path_value.is_dir():
        for candidate in ["openapi.json", "openapi.yaml", "openapi.yml"]:
            full = path_value / candidate
            if full.exists():
                return full
        return None
    if path_value.exists():
        return path_value
    if path_value.suffix == "":
        for candidate in [
            path_value.with_suffix(".json"),
            path_value.with_suffix(".yaml"),
            path_value.with_suffix(".yml"),
            path_value / "openapi.json",
            path_value / "openapi.yaml",
            path_value / "openapi.yml",
        ]:
            if candidate.exists():
                return candidate
    return None


def build_url_candidates(source: str) -> list[str]:
    parsed = urlparse(source)
    pathname = parsed.path or "/"
    if pathname.endswith((".json", ".yaml", ".yml")):
        return [source]
    base_path = pathname[:-1] if pathname.endswith("/") else pathname
    base = f"{parsed.scheme}://{parsed.netloc}{base_path}"
    return [f"{base}/openapi.json", f"{base}/openapi.yaml", f"{base}/openapi.yml", source]


def has_directory_spec(src: str) -> bool:
    candidate = pathlib.Path(src).resolve()
    if not candidate.exists() or not candidate.is_dir():
        return False
    return any((candidate / name).exists() for name in ["openapi.json", "openapi.yaml", "openapi.yml"])


def looks_like_host(value: str) -> bool:
    return "." in value and "/" not in value and "\\" not in value and value not in {".", ".."}


def is_url(value: str) -> bool:
    return value.startswith("http://") or value.startswith("https://")


def write_text(path_value: pathlib.Path, content: str) -> None:
    path_value.parent.mkdir(parents=True, exist_ok=True)
    path_value.write_text(content, encoding="utf-8")


def write_openapi_spec(path_value: pathlib.Path, spec: dict[str, Any]) -> None:
    suffix = path_value.suffix.lower()
    if suffix in {".yaml", ".yml"}:
        import yaml

        write_text(path_value, yaml.safe_dump(spec, sort_keys=False))
        return

    write_text(path_value, json.dumps(spec, indent=2) + "\n")


def fail(message: str) -> None:
    logger.error("Error: %s", message)
    raise SystemExit(1)


if __name__ == "__main__":
    main()
