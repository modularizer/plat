# Hello World

Minimal plat project. Standard layout with shared types and a source-based TS client.

```
server.ts           <- entry point
server/hello.api.ts <- controller
shared/types.ts     <- plain TS interfaces
src/api.ts          <- generated TS client
openapi.json        <- generated spec
```

## Run

```bash
npm install
npm run dev
curl http://localhost:3000/sayHello?name=plat
```

## Regenerate

```bash
plat gen          # regenerates openapi.json + src/api.ts
```
