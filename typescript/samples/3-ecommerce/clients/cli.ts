#!/usr/bin/env node
/**
 * Auto-generated OpenAPI CLI.
 * Source: /home/mod/Code/plat/typescript/samples/3-ecommerce/openapi.json
 * DO NOT EDIT MANUALLY.
 */

import { runCli } from 'plat'

const spec = {
  "openapi": "3.0.0",
  "info": {
    "title": "API",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "http://localhost:3000"
    }
  ],
  "paths": {}
} as const

runCli(spec, process.argv.slice(2))
