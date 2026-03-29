from __future__ import annotations

from pathlib import Path

from plat import create_server


def main() -> None:
    root = Path(__file__).resolve().parent
    server = create_server(
        {
            "port": 3002,
            "host": "127.0.0.1",
            "cors": True,
            "headers": {"X-Powered-By": "plat-python-long-running-sample"},
        }
    )
    server.register_glob("*.api.py", root=root)
    server.listen()


if __name__ == "__main__":
    main()
