#!/usr/bin/env node
/**
 * `plat-cli [--url <server>] <command> [--key=value ...]` — call any plat server from a terminal.
 * Server: `--url`, else $PLAT_URL, else http://localhost:3000. Token: $PLAT_TOKEN.
 */
import { runHttpCli } from './cli/http'

const raw = process.argv.slice(2)
const argv: string[] = []
let url = process.env.PLAT_URL ?? 'http://localhost:3000'
for (let i = 0; i < raw.length; i += 1) {
  const token = raw[i]!
  if (token === '--url') url = raw[++i] ?? url
  else if (token.startsWith('--url=')) url = token.slice('--url='.length)
  else argv.push(token)
}
const token = process.env.PLAT_TOKEN

void runHttpCli({ baseUrl: url, headers: token ? { authorization: `Bearer ${token}` } : undefined }, argv)
