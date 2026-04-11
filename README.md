# 🦫 plat

Protocol + Language Agnostic Tooling

> just write your methods...then call them

Start here: https://modularizer.github.io/plat/

The GitHub Pages site is now the best overview of plat. It has:
- a live interactive demo
- core philosophy and design rules
- TypeScript and Python quickstarts
- examples of generated clients, CLIs, and AI/tool-call flows

## What plat can create

From the same method surface, plat can create:
- an API with a full OpenAPI spec and Swagger/ReDoc playground
- a CLI with help text and argument parsing
- MCP and tool-call definitions for AI systems
- TypeScript / JavaScript client-side proxies
- Python client-side proxies
- browser-hosted client-side servers
- static file serving with `StaticFolder` and `FileResponse` (auto-excluded from OpenAPI)

## Tiny example

```ts
class OrdersApi {
  async createOrder({ itemId, qty }: { itemId: string; qty: number }) {
    return { orderId: "ord_123", status: "pending" }
  }
}
```

That one method surface can become:
- `POST /createOrder`
- `client.createOrder({ itemId: "sku_123", qty: 2 })`
- a CLI command
- a tool definition you can hand to an AI provider

## Docs

- GitHub Pages overview: https://modularizer.github.io/plat/
- TypeScript guide: [typescript/README.md](/home/mod/Code/plat/typescript/README.md)
- Python guide: [python/README.md](/home/mod/Code/plat/python/README.md)

## Repo layout

- [typescript/](/home/mod/Code/plat/typescript)
- [python/](/home/mod/Code/plat/python)
- [python_browser/](/home/mod/Code/plat/python_browser)
- [docs/](/home/mod/Code/plat/docs)


### Dev
`node scripts/release.mjs "client-side server + docs site" 0.2.0 --publish`
