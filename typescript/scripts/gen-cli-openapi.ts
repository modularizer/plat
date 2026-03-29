/**
 * Generate a thin CLI wrapper from an OpenAPI spec.
 *
 * Usage:
 *   npx tsx scripts/gen-cli-openapi.ts [--src <file-or-url>] [--dst <file>]
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { loadSpec } from './openapi-common.js'

async function main() {
  const args = process.argv.slice(2)
  const { spec, specSource, suggestedBaseUrl } = await loadSpec(args)
  const outPath = resolveOutputPath(args)

  await fs.mkdir(path.dirname(outPath), { recursive: true })

  if (outPath.endsWith('.py')) {
    await fs.writeFile(outPath, generatePythonCli(spec, specSource, suggestedBaseUrl), 'utf-8')
  } else {
    await fs.writeFile(outPath, generateTsCli(spec, specSource), 'utf-8')
  }

  await fs.chmod(outPath, 0o755).catch(() => {})
  console.log(`Generated ${outPath}`)
}

function resolveOutputPath(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--dst') return path.resolve(args[i + 1] ?? 'cli.ts')
    if (arg?.startsWith('--dst=')) return path.resolve(arg.slice('--dst='.length))
  }
  return path.resolve('cli.ts')
}

function generateTsCli(spec: unknown, specSource: string): string {
  const literal = JSON.stringify(spec, null, 2)
  return `#!/usr/bin/env node
/**
 * Auto-generated OpenAPI CLI.
 * Source: ${specSource}
 * DO NOT EDIT MANUALLY.
 */

import { runCli } from 'plat'

const spec = ${literal} as const

runCli(spec, process.argv.slice(2))
`
}

function generatePythonCli(spec: unknown, specSource: string, suggestedBaseUrl?: string): string {
  const baseExpr = JSON.stringify(suggestedBaseUrl ?? 'http://localhost:3000')
  const literal = JSON.stringify(spec, null, 2)
  return `#!/usr/bin/env python3
"""Auto-generated OpenAPI CLI."""

import json
import os
import sys
import urllib.parse
import urllib.request

SPEC = json.loads(r'''${literal}''')

DEFAULT_BASE_URL = ${baseExpr}


def parse_args(argv):
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
        elif isinstance(val, str) and val.lower() == "true":
            val = True
        elif isinstance(val, str) and val.lower() == "false":
            val = False
        else:
            try:
                val = int(val)
            except Exception:
                try:
                    val = float(val)
                except Exception:
                    if isinstance(val, str) and (val.startswith("{") or val.startswith("[")):
                        try:
                            val = json.loads(val)
                        except Exception:
                            pass
        result[key] = val
    return result, fmt


def to_snake_case(value):
    import re
    value = re.sub(r"[^A-Za-z0-9]+", "_", value)
    value = re.sub(r"([a-z0-9])([A-Z])", r"\\1_\\2", value)
    value = re.sub(r"([A-Z])([A-Z][a-z])", r"\\1_\\2", value)
    return value.strip("_").lower()


def extract_commands(spec):
    commands = {}
    aliases = {}
    for url_path, methods in spec.get("paths", {}).items():
        for http_method, op in methods.items():
            operation_id = op.get("operationId")
            if not operation_id:
                continue
            snake = to_snake_case(operation_id)
            commands[snake] = {
                "method": http_method.upper(),
                "path": url_path,
                "summary": op.get("summary", ""),
                "parameters": op.get("parameters", []),
                "requestBody": op.get("requestBody", {}),
            }
            aliases[operation_id] = snake
    return commands, aliases


def format_output(data, fmt):
    if fmt == "json":
        print(json.dumps(data, indent=2))
    else:
        print(json.dumps(data, indent=2))


def replace_path_params(path, values):
    for key, value in values.items():
        path = path.replace("{" + key + "}", urllib.parse.quote(str(value), safe=""))
    return path


def request(base_url, command, input_data):
    path_param_names = [p["name"] for p in command.get("parameters", []) if p.get("in") == "path"]
    query_param_names = [p["name"] for p in command.get("parameters", []) if p.get("in") == "query"]

    path_values = {name: input_data[name] for name in path_param_names if name in input_data}
    url = base_url.rstrip("/") + replace_path_params(command["path"], path_values)

    query_values = {name: input_data[name] for name in query_param_names if name in input_data}
    if query_values:
        url += "?" + urllib.parse.urlencode(query_values, doseq=True)

    body_props = (
        command.get("requestBody", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
        .get("properties", {})
    )
    body = {name: input_data[name] for name in body_props.keys() if name in input_data}
    data = json.dumps(body).encode("utf-8") if body else None

    headers = {"Content-Type": "application/json"}
    token = os.environ.get("API_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, data=data, headers=headers, method=command["method"])
    with urllib.request.urlopen(req) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload) if payload else None


def print_help(commands):
    title = SPEC.get("info", {}).get("title", "API")
    print(f"{title} CLI\\n")
    print("Usage: <command> [--key=value ...] [--format=json]\\n")
    print("Commands:")
    for name, command in sorted(commands.items()):
        print(f"  {name:<30} {command.get('summary', '')}")


def main():
    commands, aliases = extract_commands(SPEC)
    if len(sys.argv) < 2 or sys.argv[1] in ("help", "--help", "-h"):
        print_help(commands)
        sys.exit(0)

    command_name = aliases.get(sys.argv[1], sys.argv[1])
    command = commands.get(command_name)
    if command is None:
        print(f"Unknown command: {sys.argv[1]}", file=sys.stderr)
        sys.exit(1)

    input_data, fmt = parse_args(sys.argv[2:])
    result = request(os.environ.get("API_URL", DEFAULT_BASE_URL), command, input_data)
    format_output(result, fmt)


if __name__ == "__main__":
    main()
`
}

main().catch((err) => {
  console.error('❌ Generation failed:', err.message)
  process.exit(1)
})
