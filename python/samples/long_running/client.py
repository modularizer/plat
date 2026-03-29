from __future__ import annotations

import logging

from plat import create_openapi_client


def main() -> None:
    logger = logging.getLogger("plat.samples.long_running")
    client = create_openapi_client(
        "http://127.0.0.1:3002/openapi.json",
        "http://127.0.0.1:3002",
    )

    handle = client.importCatalog(
        source="s3://demo/catalog.csv",
        items=4,
        _execution="deferred",
    )

    logger.info("status %s", handle.status())
    logger.info("result %s", handle.wait())


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
