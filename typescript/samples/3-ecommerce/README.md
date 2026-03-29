# E-commerce

Multi-controller API that generates **all client types**: TypeScript, JavaScript (ESM + CJS), Python, plus CLIs.

```
server.ts                <- entry point
server/products.api.ts   <- products controller
server/orders.api.ts     <- orders controller
shared/types.ts          <- plain TS interfaces
clients/
  api.ts                 <- generated: TS client (materialized types)
  api.mjs                <- generated: JS ESM client
  api.cjs                <- generated: JS CJS client
  api_client.py          <- generated: Python client
  cli.mjs                <- generated: JS CLI
  cli.py                 <- generated: Python CLI
openapi.json             <- generated spec
```

## .env

```env
PLAT_GEN_OPENAPI=openapi.json
PLAT_GEN_CLIENT_TS=clients/api.ts
PLAT_GEN_CLIENT_JS=clients/api.mjs
PLAT_GEN_CLIENT_PY=clients/api_client.py
PLAT_GEN_CLI=clients/cli.mjs
```

## Run

```bash
npm install
npm run dev
```

## Generate

```bash
plat gen              # generates everything
plat gen openapi      # just the spec
plat gen client       # all clients (TS + JS + Python)
plat gen client:ts    # just TS client
plat gen client:py    # just Python client
plat gen cli          # all CLIs
```

## Use the CLI

```bash
# Node.js
node clients/cli.mjs listProducts --format=table
node clients/cli.mjs searchProducts --q=laptop --format=yaml
node clients/cli.mjs addToCart --userId=user1 --productId=1 --quantity=2

# Python
python clients/cli.py list_products --format=table
python clients/cli.py add_to_cart --user_id=user1 --product_id=1 --quantity=2
```

## Use the clients

```typescript
// TypeScript
import { ApiClient } from './clients/api'
const client = new ApiClient({ baseUrl: 'http://localhost:3000' })
const products = await client.listProducts({ limit: 5 })
```

```javascript
// CommonJS
const {ApiClient} = require('./api.cjs')
const client = new ApiClient({baseUrl: 'http://localhost:3000'})
```

```python
# Python
from clients.api_client import ApiClient
client = ApiClient("http://localhost:3000")
products = client.list_products(limit=5)
```
