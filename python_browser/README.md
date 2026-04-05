# plat_browser

Browser-hosted Python runtime for plat.

This package is intended for client-side Python execution environments while keeping the main `plat` package focused on normal server/client/CLI usage.

## Example

```python
from plat_browser import Controller, POST, serve_client_side_server


@Controller()
class MathApi:
    @POST()
    def add(self, a: int, b: int, ctx):
        return a + b


serve_client_side_server("browser-python-math", [MathApi])
```

It also supports hidden browser package installation syntax:

```python
!pip install pandas
```

The browser host/runtime is responsible for package loading and transport bridging. User code should stay normal Python.

Payload fields are passed into handlers as keyword arguments by default, so browser Python code can use normal Python signatures like `def add(self, a, b, ctx)`.

Browser Python can also act as a client:

```python
from plat_browser import connect_client_side_server

client = await connect_client_side_server("css://browser-python-math")
await client.add(a=20, b=22)
```

Browser Python clients can also pass optional trust inputs:

```python
client = await connect_client_side_server(
    "css://browser-python-math",
    {
        "identity": {
            "known_hosts": {},
            "authority_servers": [
                {
                    "base_url": "https://authority.example.com",
                    "public_key_jwk": {...},
                }
            ],
        }
    },
)
```

That same client helper can also connect to normal HTTP servers that expose OpenAPI:

```python
from plat_browser import connect_client_side_server

client = await connect_client_side_server("https://api.example.com")
await client.createOrder(itemId="sku_123", qty=2)
```

## css:// host identity

The `css://` transport can keep a stable host identity too.

- Browser-hosted servers can reuse a persisted public/private keypair
- Clients can trust on first use and remember a host key for later
- Clients can also verify a signed authority record for well-known server names

Those identity helpers live in the TypeScript/browser host layer so browser Python user code can stay normal Python and never mention lower-level runtime details.

## TypeScript host utilities

Use the browser host utilities from the TypeScript package:

```ts
import { startClientSidePythonServerFromSource } from '@modularizer/plat/python-browser'
```

That host layer is responsible for:
- loading the hidden browser Python runtime
- handling `!pip install ...` and import-based package installation
- serving the Python-defined methods over the same client-side-server transport utilities
