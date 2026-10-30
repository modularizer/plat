# @modularizer/plat-client

Browser-safe client for plat servers.

```bash
npm install @modularizer/plat-client          # HTTP client, light install
npm install @modularizer/plat-client mqtt     # also reach client-side servers over MQTT/WebRTC
```

`mqtt` is an optional peer dependency. It is loaded only when you connect to a client-side server; without it
installed that connection fails with `Client-side servers need the optional 'mqtt' package: npm install mqtt`.
Everything else works without it.

Only need to call a plat server from a script or terminal? `@modularizer/plat-cli` has no dependencies at all.
Need to build a server? Install `@modularizer/plat`, which bundles everything including `mqtt`.
