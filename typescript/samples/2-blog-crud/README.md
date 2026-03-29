# Blog CRUD

Full CRUD API demonstrating a **custom folder layout**. Uses `app.ts` as entry, `api/` for controllers, `types/` for type definitions, and `generated/` for output.

```
app.ts              <- entry point (not server.ts)
api/blog.api.ts     <- controllers in api/ (not server/)
types/blog.ts       <- types in types/ (not shared/)
generated/api.ts    <- generated client in generated/ (not src/)
openapi.json        <- generated spec
```

## .env

```env
PLAT_ENTRY=app.ts
PLAT_CONTROLLERS=api/**/*.api.ts
PLAT_TYPES_DIR=types/
PLAT_GEN_OPENAPI=openapi.json
PLAT_GEN_CLIENT_TS=generated/api.ts
```

## Run

```bash
npm install
npm run dev
curl http://localhost:3000/listPosts
```

## Generate

```bash
plat gen              # regenerates openapi.json + generated/api.ts
```
