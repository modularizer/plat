#!/usr/bin/env node
/**
 * plat-bridge — CLI for the HTTP⇄WebRTC bridge.
 *
 * Usage:
 *   plat-bridge --name <css-name> --upstream <http-url>
 *               [--mqtt <broker-url>] [--topic <mqtt-topic>]
 *               [--bridge-name <name>] [--trust-client-forwarded]
 *               [--no-forwarded-headers]
 *               [--allow-methods GET,POST] [--allow-paths "^/v1/.*"]
 *               [--request-timeout-ms 30000]
 */
import { createHTTPBridge } from './index'

interface ParsedArgs {
  name?: string
  upstream?: string
  mqtt?: string
  topic?: string
  bridgeName?: string
  trustClientForwarded: boolean
  noForwardedHeaders: boolean
  allowMethods?: string[]
  allowPaths?: string[]
  requestTimeoutMs?: number
  help: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    trustClientForwarded: false,
    noForwardedHeaders: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case '--name': out.name = next(); break
      case '--upstream': out.upstream = next(); break
      case '--mqtt': out.mqtt = next(); break
      case '--topic': out.topic = next(); break
      case '--bridge-name': out.bridgeName = next(); break
      case '--trust-client-forwarded': out.trustClientForwarded = true; break
      case '--no-forwarded-headers': out.noForwardedHeaders = true; break
      case '--allow-methods': {
        const val = next();
        if (val !== undefined) {
          out.allowMethods = val.split(',').map((m) => m.trim());
        }
        break;
      }
      case '--allow-paths': {
        if (!out.allowPaths) out.allowPaths = [];
        const val = next();
        if (val !== undefined) {
          out.allowPaths.push(val);
        }
        break;
      }
      case '--request-timeout-ms': out.requestTimeoutMs = Number(next()); break
      case '-h':
      case '--help': out.help = true; break
      default:
        process.stderr.write(`plat-bridge: unknown argument ${arg}\n`)
        process.exit(2)
    }
  }
  return out
}

function printHelp(): void {
  process.stdout.write(
    `plat-bridge — forward css:// WebRTC requests to an HTTP upstream\n\n`
      + `Usage: plat-bridge --name <css-name> --upstream <http-url> [options]\n\n`
      + `Required:\n`
      + `  --name <name>          css:// name this bridge serves as\n`
      + `  --upstream <url>       HTTP base URL to forward to\n\n`
      + `Signaling:\n`
      + `  --mqtt <url>           MQTT broker URL (default: public EMQX broker)\n`
      + `  --topic <name>         MQTT topic\n\n`
      + `Forwarding:\n`
      + `  --bridge-name <name>        X-Forwarded-By label (default: --name)\n`
      + `  --trust-client-forwarded    Preserve and append to client X-Forwarded-For\n`
      + `  --no-forwarded-headers      Disable X-Forwarded-* / Forwarded injection\n`
      + `  --allow-methods GET,POST    Comma-separated method allowlist\n`
      + `  --allow-paths <regex>       Repeatable path allowlist regex\n`
      + `  --request-timeout-ms <n>    Upstream request timeout (default: 30000)\n`,
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }
  if (!args.name || !args.upstream) {
    process.stderr.write('plat-bridge: --name and --upstream are required (use --help)\n')
    process.exit(2)
  }

  const bridge = createHTTPBridge({
    name: args.name,
    upstream: args.upstream,
    mqttBroker: args.mqtt,
    mqttTopic: args.topic,
    bridgeName: args.bridgeName,
    trustClientForwarded: args.trustClientForwarded,
    disableForwardedHeaders: args.noForwardedHeaders,
    allowMethods: args.allowMethods,
    allowPaths: args.allowPaths,
    requestTimeoutMs: args.requestTimeoutMs,
  })
  await bridge.start()
  process.stdout.write(`plat-bridge listening on ${bridge.cssUrl} → ${args.upstream}\n`)

  const shutdown = async (signal: NodeJS.Signals) => {
    process.stdout.write(`\nplat-bridge: received ${signal}, stopping…\n`)
    await bridge.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  process.stderr.write(`plat-bridge: fatal: ${error?.stack ?? error?.message ?? error}\n`)
  process.exit(1)
})
