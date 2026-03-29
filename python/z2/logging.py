from __future__ import annotations

import logging
import sys
from typing import Final


class _MaxLevelFilter(logging.Filter):
    def __init__(self, level: int) -> None:
        super().__init__()
        self._level = level

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno <= self._level


_CONFIGURED: Final[set[str]] = set()


def get_logger(name: str = "plat") -> logging.Logger:
    logger = logging.getLogger(name)
    if name not in _CONFIGURED:
        logger.setLevel(logging.DEBUG)
        logger.propagate = False

        stdout_handler = logging.StreamHandler(sys.stdout)
        stdout_handler.setLevel(logging.DEBUG)
        stdout_handler.addFilter(_MaxLevelFilter(logging.INFO))
        stdout_handler.setFormatter(logging.Formatter("%(message)s"))

        stderr_handler = logging.StreamHandler(sys.stderr)
        stderr_handler.setLevel(logging.WARNING)
        stderr_handler.setFormatter(logging.Formatter("%(message)s"))

        logger.handlers.clear()
        logger.addHandler(stdout_handler)
        logger.addHandler(stderr_handler)
        _CONFIGURED.add(name)
    return logger
