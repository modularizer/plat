# SaaS Analytics

JWT-authenticated analytics API with a **nested `src/` layout**. Generates a **Python client and CLI**.

```
src/
  index.ts               <- entry point (not root server.ts)
  api/analytics.api.ts   <- controllers in src/api/
shared/types.ts          <- plain TS interfaces
dist/
  api_client.py          <- generated: Python client
  cli.py                 <- generated: Python CLI
openapi.json             <- generated spec
```

## .env

```env
PLAT_ENTRY=src/index.ts
PLAT_CONTROLLERS=src/api/**/*.api.ts
PLAT_TYPES=generated
PLAT_GEN_OPENAPI=openapi.json
PLAT_GEN_CLIENT_PY=dist/api_client.py
PLAT_GEN_CLI=dist/cli.py
```

## Run

```bash
npm install
npm run dev
```

## Auth

```bash
# Public endpoint (no auth)
curl http://localhost:3000/getProfile?id=user123

# Generate a JWT token
plat jwt generate --user-id=user123 --role=analyst

# Use with protected endpoints
curl -H "Authorization: Bearer TOKEN" http://localhost:3000/getAnalytics
```

## Python CLI

```bash
python dist/cli.py get_profile --id=user123 --format=table
API_URL=http://localhost:3000 python dist/cli.py list_events --format=yaml
```
