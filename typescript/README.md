# 🦫 plat (aka "platypus")
> **"call it like you're there"**

plat is a **Protocol and Language Agnostic Tooling Yielding Proxy-like Universal Semantics**. In short:
- just write your methods...
- ...then call them

#### It doesn't matter what you are designing
- Standard REST API
- MCP Server
- A CLI tool
- Database CRUD
- AI Tool Calls
- Inter Process Communication
- Worker Queues
- Client-to-client Chat Room

> At the end of the day, all there is is **handlers and callers**.

#### Yes there is an API layer there, but it isn't really your concern.
- auth
- exceptions
- headers
- serialization/deserialization/type coercion
- param validation
- route building
- response building
- rate limiting
- caching
- client-side retry logic
- client-side param validation

> All of that can be **handled easily behind the scenes** with easily standardizable **middleware plugins**.

#### In fact, the transport method itself doesn't even matter:
- HTTP
- WS
- File Queues
- DB triggers
- Zapier Integrations
- External APIs
- USPS mail delivery

> It's all important, but your function handler **does not need to know** about it, and **neither does your call site**.


#### Okay, seriously ... what are we even talking about here?
Fair... try this

---
# Quickstart

## 1. Install
```bash
npm i modularizer-plat
```

---

## 2. Make a server

```ts
import { Controller, POST, createServer, type RouteContext } from "plat"

@Controller()
class OrdersApi {
  @POST()
  async createOrder(
    input: { itemId: string; qty: number },
    ctx: RouteContext,
  ): Promise<{ orderId: string; status: string }> {
    return { orderId: "ord_123", status: "pending" }
  }
}

const server = createServer({ port: 3000 }, OrdersApi)
server.listen()
```

## 3. Serve it with the CLI

```bash
plat serve
```

## 4. See the docs

```bash
open http://localhost:3000/
```

## 5. Make a client

```bash
plat gen client http://localhost:3000/ --dst client.ts
```

```ts
import { createClient } from "./client"


const client = createClient("http://localhost:3000")
const order = await client.createOrder({ itemId: "sku_123", qty: 2 })
console.log(order)
```

## 6. Make a CLI

```bash
plat gen cli http://localhost:3000/ --dst cli.ts
```

```bash
npx tsx cli.ts createOrder --itemId=sku_123 --qty=2
```

## 7. Let your AI loose

```ts
import { OpenAPIClient } from "plat"


const spec = await fetch("http://localhost:3000/openapi.json").then((r) => r.json())
const client = new OpenAPIClient(spec, { baseUrl: "http://localhost:3000" })

const tools = client.tools
// hand `tools` to your AI provider
// then call back into `client.createOrder(...)` when it selects a tool
```

## Use it

- Client call: `client.createOrder({ itemId: "...", qty: 2 })`
- Generated CLI call: `plat createOrder --itemId=... --qty=2`
- AI tool call: an LLM can see `createOrder` as a tool with a name, input shape, and result shape
- Documentation: generated `openapi.json`, plus docs/tool metadata derived from the same method


---


## 🎯 Why plat exists

Most API frameworks make you think about:

- routes
- methods
- headers
- authentication
- serialization/deserialization/coercion
- sending responses
- REST hierarchies
- request shapes
- wire protocols
- client generation drift
- transport details

plat tries to make most of that disappear.

What you should be thinking about is:

- what methods exist
- what input each method accepts
- what result each method returns

That’s the part plat treats as sacred.

> It feels like you are adding a new class, and behind the scenes an API is born

One of the biggest reasons plat exists is to make it easy to use **any AI provider**:

- on the client side
- on the server side
- as the initiator of your tasks
- or as the doer of your tasks
- or both

Everything below is in service of that same promise: define useful methods once, then let clients, CLIs, docs, and AI tools all see the same surface.

### Diagram

```                                                                  
┌───────────────────────────────────────────────────────┐            
│                   Tool Definitions                    │            
│           (controllers + decorated methods)           │            
│                                                       │            
│  TypeScript (plain types)    Python (type hints)      │            
│  class Orders {              @Controller()            │            
│    @Post()                   class Orders:            │            
│    create(input, ctx) {}       @POST()                │            
│    @Get()                      def create(self): ...  │            
│    list(input, ctx) {}         @GET()                 │            
│  }                             def list(self): ...    │            
└──────────────────────────┬────────────────────────────┘            
                           │                                         
                ┌──────────┴──────────┐                              
                │  Operation Registry │                              
                │                     │                              
                │  operationId ─────► bound handler                  
                │  method+path ─────► bound handler                  
                └──────────┬──────────┘                              
                           │                                         
         server protocol plugins (how tool calls arrive)             
                           │                                         
    ┌───────┬────────┬─────┴───┬────────┬───────┬───────┐            
    │       │        │         │        │       │       │            
┌───┴──┐┌───┴──┐┌────┴───┐┌────┴───┐┌───┴──┐┌───┴──┐┌───┴──┐         
│ HTTP ││  WS  ││  File  ││ WebRTC ││  DB  ││BullMQ││ MQTT │         
│ REST ││  RPC ││ Queue  ││  Data  ││ Poll ││ Redis││Pub/  │         
│      ││      ││        ││  Chan  ││ Rows ││Queue ││ Sub  │         
└──────┘└──────┘└────────┘└────────┘└──────┘└──────┘└──────┘         
                            ...                                      
       literally anything that can carry a JSON envelope             
                            ...                                      
┌──────┐┌──────┐┌────────┐┌────────┐┌──────┐┌──────┐┌──────┐         
│ HTTP ││  WS  ││  File  ││ WebRTC ││ POST ││ eBay ││  FB  │         
│ fetch││  RPC ││   IO   ││  Peer  ││to ext││ list ││ Msg  │         
│      ││      ││        ││  Conn  ││  API ││ poll ││ poll │         
└───┬──┘└───┬──┘└────┬───┘└────┬───┘└───┬──┘└───┬──┘└───┬──┘         
    │       │        │         │        │       │       │            
    └───────┴────────┴────┬────┴────────┴───────┴───────┘            
                          │                                          
        client transport plugins (how tool calls are sent)           
                          │                                          
               ┌──────────┴──────────┐                               
               │    OpenAPI Client   │                               
               │    (typed proxy)    │                               
               └──────────┬──────────┘                               
                          │                                          
       ┌─────────┬────────┼────────┬───────────┐                     
       │         │        │        │           │                     
  ┌────┴───┐┌────┴───┐┌───┴───┐┌───┴────┐┌─────┴─────┐               
  │   TS   ││ Python ││  CLI  ││  curl  ││ LLM Agent │               
  │        ││        ││       ││  bash  ││           │               
  │  node  ││  sync  ││ plat do ││ write  ││  Claude   │               
  │  bun   ││ async  ││plat poll││ JSON   ││  ChatGPT  │               
  │ browser││ promise││       ││to inbox││  Gemini   │               
  └────────┘└────────┘└───────┘└────────┘└───────────┘               
```                                                                  

The transport protocol, serialization, deserialization, queueing, and delivery mechanics are intentionally pushed out of your way.

That is especially powerful for AI-heavy systems, because you can keep swapping providers and execution patterns while preserving the same tool-shaped surface.

## 🎭 What the user experience should feel like

It should feel like this:

```ts
const order = await client.createOrder({ itemId: "sku_123", qty: 2 })
```

Not like this:

- choosing between totally different client libraries
- hand-authoring RPC envelopes
- thinking about HTTP vs WS every time you call a method
- manually syncing method names, routes, SDK methods, and OpenAPI operation IDs
- re-implementing error handling, retries, and auth every time you make a request
- refactoring if you change languages or protocols
- endless boilerplate

It's like an SDK except you don't have to write it. It just comes for free with every `openapi.json`.

## 🦫 Flat by design

plat is intentionally opinionated about the API shape.

<details open>
<summary><strong>The rules</strong></summary>

- Method names are globally unique
- Method names are the canonical route names
- Input comes in as one object
- Return values matter as first-class API types
- Controllers organize code and docs, not URL hierarchies
- The API surface stays flat and easy to call

</details>

### Example

```ts
import { Controller, GET, POST, type RouteContext } from "plat"

type GetOrderInput = { id: string }
type CreateOrderInput = { itemId: string; qty: number }
type Order = { id: string; status: string }

@Controller()
export class OrdersApi {
  @GET()
  async getOrder(input: GetOrderInput, ctx: RouteContext): Promise<Order> {
    return { id: input.id, status: "pending" }
  }

  @POST()
  async createOrder(input: CreateOrderInput, ctx: RouteContext): Promise<Order> {
    return { id: "ord_123", status: "pending" }
  }
}
```

Canonical routes:

- `GET /getOrder`
- `POST /createOrder`

Canonical client calls:

```ts
await client.getOrder({ id: "ord_123" })
await client.createOrder({ itemId: "sku_123", qty: 2 })
```

That flatness matters because it makes the generated and dynamic clients obvious:

- easy for humans to remember
- easy for CLIs to expose
- easy for AI agents to understand
- easy for generated clients to mirror exactly
- easy to hand to any AI provider as tool definitions

## ⏳ Long-running calls without changing the mental model

Sometimes a method is fast:

```ts
await client.createOrder({ itemId: "sku_123", qty: 2 })
```

Sometimes a method is slow, and you want visibility:

```ts
await client.importCatalog(
  { source: "s3://bucket/catalog.csv" },
  {
    onRpcEvent(event) {
      console.log(event.event, event.data)
    },
  },
)
```

Or you want deferred execution:

```ts
const handle = await client.importCatalog(
  { source: "s3://bucket/catalog.csv" },
  { execution: "deferred" },
)

const result = await handle.wait()
```

The important part is that it is still the same method.

As a bonus, in the right mode you can get:

- progress updates
- logs
- chunks/messages
- cancellation

That is what most users actually care about. The carrier and plugin details are for transport authors.

## 🐍 Python support

plat supports Python servers and clients too.

You can:

- write Python controllers with plat decorators
- generate OpenAPI from `*.api.py`
- generate Python clients from OpenAPI
- use sync, async, and promise-style Python clients

<details>
<summary><strong>Python highlights</strong></summary>

- Sync clients
- Async clients
- Promise-style clients
- Deferred call handles
- Automatic input coercion
- Automatic output serialization
- First-class HTTP exception types

</details>

## 🔌 One client, many transports

The same method call should stay usable even when transport changes.

```ts
const httpClient = createClient("http://localhost:3000")
const rpcClient = createClient("ws://localhost:3000")
const fileClient = createClient("file:///tmp/plat-queue")

await httpClient.createOrder({ itemId: "sku_123", qty: 2 })
await rpcClient.createOrder({ itemId: "sku_123", qty: 2 })
await fileClient.createOrder({ itemId: "sku_123", qty: 2 })
```

Same tool call. Different carrier.

### Diagram

```txt
   createOrder({ itemId, qty })
              │
      ┌───────┼────────┐
      │       │        │
      ▼       ▼        ▼
    HTTP     WS      File
      │       │        │
      └───────┼────────┘
              ▼
       same type-aware method call
```

## 🤖 AI tool calling

plat is a natural fit for LLM tools because the API shape is already tool-shaped.

Every operation has:

- a stable name
- one input object
- one result
- generated schema

That means you can use AI providers in whichever role you want:

- as the caller deciding what tools to use
- as the worker fulfilling part of a task
- as interchangeable providers inside the same larger workflow
- on the client side or the server side

That makes the same API useful to:

- normal app code
- a CLI
- generated SDKs
- an LLM agent

## 🧰 Dynamic clients and generated clients

plat supports both styles.

<details>
<summary><strong>Dynamic clients</strong></summary>

The OpenAPI client can work directly from an OpenAPI document and a runtime proxy.

Best when you want:

- low ceremony
- transport flexibility
- no generated wrapper code

</details>

<details>
<summary><strong>Generated clients</strong></summary>

plat can also generate clients that materialize types and methods.

Especially useful in Python, where explicit generated models and wrappers help more than in TypeScript.

</details>

## 🖥️ CLI

plat includes a spec-first CLI.

```bash
plat gen openapi
plat gen client
plat gen cli
plat run openapi.json
plat serve
```

The CLI is available from both Node and Python packaging surfaces, with capability moving toward parity.

## 🧩 Plugin architecture

The plugin architecture matters, but mostly as an implementation and extension story.

For normal plat users, the important thing is:

- methods stay flat
- typing stays strong
- clients feel direct
- transport details stay hidden
- provider complexity stays hidden too

For plugin developers, plat provides the escape hatch.

### Client-side transport plugins

Transport plugins follow a generic lifecycle:

- connect
- send request
- receive updates
- receive result
- disconnect

### Server-side protocol plugins

Protocol plugins are how tool calls arrive and how updates/results leave.

The goal is for the core method/typing/invocation story to be independent from:

- HTTP
- WebSockets
- Node
- any specific host process

<details>
<summary><strong>Why this matters</strong></summary>

That is what enables ideas like:

- a browser-side server
- a mobile-hosted server
- a worker-hosted server
- IndexedDB-backed local APIs
- WebRTC-based peer-to-peer tools
- custom carriers like DB polling or Redis streams

Most users should not have to think about any of this unless they are building a transport.

</details>

## 🌍 What makes plat different

Most systems force you to choose:

- REST or RPC
- server or client
- app integration or AI tool integration
- HTTP or "something custom"

plat is trying to collapse those choices into one model:

1. Define useful tools
2. Expose them everywhere
3. Change carriers without changing the API itself

That makes plat especially interesting for:

- internal tools
- AI agents
- automation systems
- offline-first systems
- browser-hosted local APIs
- weird protocol experiments

## 🛣️ Direction

plat is actively moving toward:

- deeper transport neutrality
- stronger portable server core extraction
- easier custom protocol plugins
- stronger generated clients and CLIs
- better cross-language symmetry

The north star is simple:

> **Define tools once. Call them from anywhere. Carry them over anything.**
