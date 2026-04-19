import unittest
import asyncio
import json
from plat.http_webrtc_bridge import HTTPBridgeOptions, HTTPWebRTCBridgeHandler

class FakeChannel:
    def __init__(self):
        self.sent = []
        self._queue = asyncio.Queue()
    def __aiter__(self):
        return self
    async def __anext__(self):
        return await self._queue.get()
    async def send(self, msg):
        self.sent.append(json.loads(msg))
    def push(self, msg):
        self._queue.put_nowait(msg)

class HTTPWebRTCBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Start a simple HTTP server for upstream
        from http.server import BaseHTTPRequestHandler, HTTPServer
        import threading
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"hello": "world"}')
            def log_message(self, *a, **k):
                pass
        self.httpd = HTTPServer(('127.0.0.1', 0), Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
    async def asyncTearDown(self):
        self.httpd.shutdown()
        self.thread.join()
    async def test_get_request(self):
        opts = HTTPBridgeOptions(upstream=f'http://127.0.0.1:{self.port}', css_name='test')
        handler = HTTPWebRTCBridgeHandler(opts)
        chan = FakeChannel()
        req = json.dumps({"type": "PLAT_REQUEST", "id": "r1", "method": "GET", "path": "/"})
        chan.push(req)
        # Run the handler in the background
        handler_task = asyncio.create_task(handler.handle_channel(chan))
        # Wait for the response to be sent
        for _ in range(20):
            if chan.sent:
                break
            await asyncio.sleep(0.1)
        # Cancel the handler task
        handler_task.cancel()
        try:
            await handler_task
        except asyncio.CancelledError:
            pass
        self.assertTrue(chan.sent, "No response sent on channel")
        self.assertEqual(chan.sent[0]["status"], 200)
        self.assertEqual(json.loads(chan.sent[0]["body"]), {"hello": "world"})

if __name__ == "__main__":
    unittest.main()


