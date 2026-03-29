#!/usr/bin/env node
/**
 * Auto-generated CLI — DO NOT EDIT
 * Usage: cli.mjs <command> [--key=value ...] [--format=json|yaml|table|csv|human]
 */
import { runCli } from 'plat'
import { readFileSync } from 'node:fs'

const spec = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf-8'))
runCli(spec)
