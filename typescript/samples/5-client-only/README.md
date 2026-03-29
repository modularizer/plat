# Client-Only

**No server code.** This sample demonstrates consuming an API from a separate repo by generating clients from `openapi.json`.

```
openapi.json      <- the spec (copied or fetched from a running server)
api.ts            <- generated: TS client with materialized types
api.mjs           <- generated: JS ESM client
api.cjs           <- generated: JS CJS client
api_client.py     <- generated: Python client
cli.mjs           <- generated: JS CLI
cli.ts            <- generated: TS CLI
cli.py            <- generated: Python CLI
```

## .env

```env
PLAT_SPEC=openapi.json
PLAT_TYPES=generated
PLAT_GEN_CLIENT_TS=api.ts
PLAT_GEN_CLIENT_JS=api.mjs
PLAT_GEN_CLIENT_PY=api_client.py
PLAT_GEN_CLI=cli.mjs
```

You can also point `PLAT_SPEC` at a URL:

```env
PLAT_SPEC=http://localhost:3000/openapi.json
```

## Generate

```bash
plat gen              # generates all clients + CLIs
```

## Use

```bash
# Node.js CLI
API_URL=http://localhost:3000 node cli.mjs listProducts --format=table

# Python CLI
API_URL=http://localhost:3000 python cli.py list_products --format=human

# TypeScript import
import { ApiClient } from './api'
const client = new ApiClient({ baseUrl: 'http://localhost:3000' })

# CommonJS require
const { ApiClient } = require('./api.cjs')

# Python
from api_client import ApiClient
client = ApiClient("http://localhost:3000")
```

## When to use this pattern

- You consume an API built by another team
- The API server lives in a different repo
- You want typed clients without access to the server source code
- You want to generate clients in multiple languages from one spec
