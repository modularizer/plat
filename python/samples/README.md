# Python Samples

This folder contains the current Python-first `plat` examples.

Right now there are two curated samples:

- `basic/` for the core HTTP flow
- `long_running/` for progress, logs, and deferred calls

## Start here

Use `basic/` first:

- `basic/products.api.py`
- `basic/orders.api.py`
- `basic/models.py`
- `basic/server.py`

That sample shows the core Python `plat` flow:

1. write flat decorated controller methods
2. serve them
3. generate `openapi.json`
4. generate a client or CLI from the spec
5. call methods like local functions

## What the samples demonstrate

- `basic/`
  - Flat `@Controller` methods
  - Pydantic request/response models
  - Multiple controllers in one server
  - Python server bootstrap
  - Python CLI serving via autodiscovery
- `long_running/`
  - `ctx.call` progress/log events
  - deferred HTTP call handles
  - the “same method, richer execution mode” story

## Quick run

From the repo root:

```bash
PYTHONPATH=python python3 python/samples/basic/server.py
PYTHONPATH=python python3 python/samples/long_running/server.py
```

Or use the Python `plat` CLI:

```bash
PYTHONPATH=python python3 -m plat serve python/samples/basic --port 3001
PYTHONPATH=python python3 -m plat serve python/samples/long_running --port 3002
```

Generate the spec:

```bash
PYTHONPATH=python python3 -m plat gen openapi python/samples/basic --dst /tmp/openapi.json
```

Generate a client:

```bash
PYTHONPATH=python python3 -m plat gen client /tmp/openapi.json --dst /tmp/client.py
```

Generate a CLI:

```bash
PYTHONPATH=python python3 -m plat gen cli /tmp/openapi.json --dst /tmp/cli.py
```

## Folder guide

- `basic/`
  - baseline CRUD-style API sample
- `long_running/`
  - progress/log/deferred-call sample

## Recommended reading order

1. `basic/models.py`
2. `basic/products.api.py`
3. `basic/orders.api.py`
4. `basic/server.py`
5. `long_running/imports.api.py`
6. `long_running/server.py`

## Test coverage

The sample is exercised by:

```bash
PYTHONPATH=python python3 -m unittest python.tests.test_samples -v
```

## What is still missing

The Python sample suite still needs more curated examples for:

- long-running calls with progress/log/cancel
- generated Python client usage
- generated Python CLI usage
- auth
- file queue transport
- AI tool calling

So this folder is a good base, but not yet the complete showcase `plat` deserves.
