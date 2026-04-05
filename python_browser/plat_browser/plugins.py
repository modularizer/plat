from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from .errors import HttpError


@dataclass
class BucketConfig:
    max_balance: float
    fill_interval: int
    fill_amount: float
    refunded_status_codes: list[int] | None = None
    refund_successful: bool | None = None
    min_balance: float = 0


@dataclass
class RateLimitEntry:
    key: str | None = None
    cost: float | None = None
    config: BucketConfig | None = None


RateLimitMeta = RateLimitEntry | list[RateLimitEntry]


@dataclass
class ResolvedRateLimitEntry:
    key: str
    cost: float
    config: BucketConfig


@dataclass
class RateLimitContext:
    entries: list[ResolvedRateLimitEntry]
    remaining_balances: list[float]


class RateLimitController(Protocol):
    def check(self, key: str, config: BucketConfig) -> float:
        ...

    def deduct(self, key: str, cost: float, config: BucketConfig) -> float:
        ...

    def refund(self, key: str, cost: float, config: BucketConfig) -> None:
        ...


@dataclass
class TokenCallCostFormula:
    initial: float | None = None
    per_limit: float | None = None
    per_char: float | None = None


@dataclass
class TokenResponseCostFormula:
    per_ms: float | None = None
    per_item: float | None = None
    per_char: float | None = None
    per_key: float | None = None


TokenCallCostSpec = float | int | TokenCallCostFormula | Callable[[Any, Any], float]
TokenResponseCostSpec = float | int | TokenResponseCostFormula | Callable[[Any, Any, Any], float]
TokenFailureCostSpec = float | int | Callable[[Exception, Any, Any], float]


@dataclass
class TokenLimitEntry:
    key: str | None = None
    call_cost: TokenCallCostSpec | None = None
    response_cost: TokenResponseCostSpec | None = None
    failure_cost: TokenFailureCostSpec | None = None
    config: BucketConfig | None = None


TokenLimitMeta = TokenLimitEntry | list[TokenLimitEntry]


@dataclass
class TokenLimitTiming:
    start_ms: int
    end_ms: int
    duration_ms: int


@dataclass
class ResolvedTokenLimitEntry:
    key: str
    call_cost: float
    response_cost_spec: TokenResponseCostSpec | None
    failure_cost_spec: TokenFailureCostSpec | None
    config: BucketConfig


@dataclass
class TokenLimitContext:
    entries: list[ResolvedTokenLimitEntry]
    remaining_balances: list[float]
    response_costs: list[float] = field(default_factory=list)
    failure_costs: list[float] = field(default_factory=list)
    timing: TokenLimitTiming | None = None


class TokenLimitController(Protocol):
    def check(self, key: str, config: BucketConfig) -> float:
        ...

    def deduct(self, key: str, cost: float, config: BucketConfig) -> float:
        ...

    def refund(self, key: str, cost: float, config: BucketConfig) -> None:
        ...


@dataclass
class CacheEntry:
    key: str
    ttl: int | None = None
    methods: list[str] | None = None


CacheMeta = CacheEntry | list[CacheEntry]


@dataclass
class CacheContext:
    key: str | None
    hit: bool
    stored: bool


class CacheController(Protocol):
    def get(self, key: str) -> Any:
        ...

    def set(self, key: str, value: Any, ttl_seconds: int | None = None) -> None:
        ...

    def clear(self, key: str) -> None:
        ...


RateLimitConfigs = dict[str, BucketConfig]
TokenLimitConfigs = dict[str, BucketConfig]


def resolve_rate_limit_key(raw: str, method_name: str, base_path: str, user: Any = None) -> str:
    return _resolve_common_key(raw, method_name, base_path, user)


def resolve_token_limit_key(raw: str, method_name: str, base_path: str, user: Any = None) -> str:
    return _resolve_common_key(raw, method_name, base_path, user)


def resolve_cache_key(template: str, params: dict[str, Any], method_name: str, base_path: str, user: Any = None) -> str:
    key = _resolve_common_key(template, method_name, base_path, user)
    for match in set(part for part in _find_template_matches(key, "{", "}")):
        name = match[1:-1]
        value = params.get(name)
        if value is not None:
            key = key.replace(match, str(value))
    return key


def create_in_memory_rate_limit() -> RateLimitController:
    buckets: dict[str, dict[str, float]] = {}
    return _create_in_memory_bucket_controller(buckets, "Rate limit exceeded")


def create_in_memory_token_limit() -> TokenLimitController:
    buckets: dict[str, dict[str, float]] = {}
    return _create_in_memory_bucket_controller(buckets, "Token limit exceeded")


def create_in_memory_cache() -> CacheController:
    store: dict[str, dict[str, Any]] = {}

    class Controller:
        def get(self, key: str) -> Any:
            entry = store.get(key)
            if entry is None:
                return None
            expires_at = entry.get("expires_at")
            if expires_at is not None and time.time() * 1000 > expires_at:
                store.pop(key, None)
                return None
            return entry["value"]

        def set(self, key: str, value: Any, ttl_seconds: int | None = None) -> None:
            expires_at = None
            if ttl_seconds is not None:
                expires_at = time.time() * 1000 + ttl_seconds * 1000
            store[key] = {"value": value, "expires_at": expires_at}

        def clear(self, key: str) -> None:
            store.pop(key, None)

    return Controller()


def apply_rate_limit_check(
    meta: RateLimitMeta | None,
    controller: RateLimitController,
    configs: RateLimitConfigs,
    method_name: str,
    base_path: str,
    user: Any = None,
) -> tuple[list[ResolvedRateLimitEntry], list[float]]:
    if meta is None:
        return [], []

    entries = meta if isinstance(meta, list) else [meta]
    resolved: list[ResolvedRateLimitEntry] = []
    remaining_balances: list[float] = []
    for entry in entries:
        raw_key = entry.key or ":route"
        key = resolve_rate_limit_key(raw_key, method_name, base_path, user)
        cost = float(entry.cost if entry.cost is not None else 1)
        config = entry.config or configs.get(key)
        if config is None:
            raise ValueError(f'Rate limit config not found for key "{key}".')
        remaining = controller.deduct(key, cost, config)
        resolved.append(ResolvedRateLimitEntry(key=key, cost=cost, config=config))
        remaining_balances.append(remaining)
    return resolved, remaining_balances


def apply_rate_limit_refund(
    entries: list[ResolvedRateLimitEntry],
    controller: RateLimitController,
    status_code: int,
) -> None:
    for entry in entries:
        config = entry.config
        should_refund = (
            (config.refunded_status_codes and status_code in config.refunded_status_codes)
            or (config.refund_successful and 200 <= status_code < 300)
        )
        if should_refund:
            controller.refund(entry.key, entry.cost, config)


def apply_token_limit_check(
    meta: TokenLimitMeta | None,
    controller: TokenLimitController,
    configs: TokenLimitConfigs,
    method_name: str,
    base_path: str,
    params: Any,
    ctx: Any,
    user: Any = None,
) -> tuple[list[ResolvedTokenLimitEntry], list[float]]:
    if meta is None:
        return [], []

    entries = meta if isinstance(meta, list) else [meta]
    resolved: list[ResolvedTokenLimitEntry] = []
    remaining_balances: list[float] = []
    for entry in entries:
        raw_key = entry.key or ":route"
        key = resolve_token_limit_key(raw_key, method_name, base_path, user)
        call_cost = resolve_call_cost(entry.call_cost if entry.call_cost is not None else 1, params, ctx)
        config = entry.config or configs.get(key)
        if config is None:
            raise ValueError(f'Token limit config not found for key "{key}".')
        remaining = controller.deduct(key, call_cost, config)
        resolved.append(
            ResolvedTokenLimitEntry(
                key=key,
                call_cost=call_cost,
                response_cost_spec=entry.response_cost,
                failure_cost_spec=entry.failure_cost,
                config=config,
            )
        )
        remaining_balances.append(remaining)
    return resolved, remaining_balances


def apply_token_limit_response(
    entries: list[ResolvedTokenLimitEntry],
    controller: TokenLimitController,
    result: Any,
    timing: TokenLimitTiming,
    params: Any,
    status_code: int,
) -> list[float]:
    response_costs: list[float] = []
    for entry in entries:
        config = entry.config
        should_refund_call = (
            (config.refunded_status_codes and status_code in config.refunded_status_codes)
            or (config.refund_successful and 200 <= status_code < 300)
        )
        if should_refund_call:
            controller.refund(entry.key, entry.call_cost, config)
            continue
        response_cost = resolve_response_cost(entry.response_cost_spec, result, timing, params)
        if response_cost > 0:
            controller.deduct(entry.key, response_cost, config)
        response_costs.append(response_cost)
    return response_costs


def apply_token_limit_failure(
    entries: list[ResolvedTokenLimitEntry],
    controller: TokenLimitController,
    error: Exception,
    timing: TokenLimitTiming,
    params: Any,
    status_code: int,
) -> list[float]:
    failure_costs: list[float] = []
    for entry in entries:
        failure_cost = resolve_failure_cost(entry.failure_cost_spec, error, timing, params)
        if failure_cost > 0:
            controller.deduct(entry.key, failure_cost, entry.config)
        elif failure_cost < 0:
            controller.refund(entry.key, -failure_cost, entry.config)
        else:
            config = entry.config
            should_refund_call = (
                (config.refunded_status_codes and status_code in config.refunded_status_codes)
                or (config.refund_successful and 200 <= status_code < 300)
            )
            if should_refund_call:
                controller.refund(entry.key, entry.call_cost, config)
        failure_costs.append(failure_cost)
    return failure_costs


def apply_cache_check(
    meta: CacheMeta | None,
    controller: CacheController,
    params: dict[str, Any],
    http_method: str,
    method_name: str,
    base_path: str,
    user: Any = None,
) -> tuple[str | None, bool, Any, CacheEntry | None]:
    if meta is None:
        return None, False, None, None

    entries = meta if isinstance(meta, list) else [meta]
    for entry in entries:
        methods = entry.methods or ["GET"]
        if http_method not in methods:
            continue
        cache_key = resolve_cache_key(entry.key, params, method_name, base_path, user)
        cached_value = controller.get(cache_key)
        if cached_value is not None:
            return cache_key, True, cached_value, entry
        return cache_key, False, None, entry
    return None, False, None, None


def apply_cache_store(cache_key: str | None, entry: CacheEntry | None, controller: CacheController, result: Any) -> None:
    if cache_key is not None and entry is not None:
        controller.set(cache_key, result, entry.ttl)


def resolve_call_cost(spec: TokenCallCostSpec | None, params: Any, ctx: Any) -> float:
    if spec is None:
        return 1
    if isinstance(spec, (int, float)):
        return float(spec)
    if isinstance(spec, TokenCallCostFormula):
        limit = _get_value(params, "limit", 0)
        param_chars = len(json.dumps(params, default=str))
        return (
            float(spec.initial or 0)
            + float(spec.per_limit or 0) * float(limit)
            + float(spec.per_char or 0) * param_chars
        )
    return float(spec(params, ctx))


def resolve_response_cost(spec: TokenResponseCostSpec | None, result: Any, timing: TokenLimitTiming, params: Any) -> float:
    if spec in {None, 0}:
        return 0
    if isinstance(spec, (int, float)):
        return float(spec)
    if isinstance(spec, TokenResponseCostFormula):
        return (
            float(spec.per_ms or 0) * timing.duration_ms
            + float(spec.per_item or 0) * _count_items(result)
            + float(spec.per_char or 0) * len(json.dumps(result, default=str))
            + float(spec.per_key or 0) * _count_keys(result)
        )
    return float(spec(result, timing, params))


def resolve_failure_cost(spec: TokenFailureCostSpec | None, error: Exception, timing: TokenLimitTiming, params: Any) -> float:
    if spec in {None, 0}:
        return 0
    if isinstance(spec, (int, float)):
        return float(spec)
    return float(spec(error, timing, params))


def _resolve_common_key(raw: str, method_name: str, base_path: str, user: Any = None) -> str:
    key = raw.replace(":route", method_name).replace(":parent", base_path)
    if user is not None:
        user_id = _get_value(user, "sub") or _get_value(user, "id")
        if user_id is not None:
            key = key.replace(":user", str(user_id))
        tier = _get_value(user, "tier") or _get_value(user, "plan")
        if tier is not None:
            key = key.replace(":tier", str(tier))
        for match in set(part for part in _find_user_tokens(key)):
            field = match[6:]
            value = _get_value(user, field)
            if value is not None:
                key = key.replace(match, str(value))
    return key


def _find_user_tokens(value: str) -> list[str]:
    parts: list[str] = []
    start = 0
    token = ":user:"
    while True:
        idx = value.find(token, start)
        if idx < 0:
            break
        end = idx + len(token)
        while end < len(value) and (value[end].isalnum() or value[end] == "_"):
            end += 1
        parts.append(value[idx:end])
        start = end
    return parts


def _find_template_matches(value: str, open_char: str, close_char: str) -> list[str]:
    parts: list[str] = []
    start = 0
    while True:
        left = value.find(open_char, start)
        if left < 0:
            break
        right = value.find(close_char, left + 1)
        if right < 0:
            break
        parts.append(value[left : right + 1])
        start = right + 1
    return parts


def _get_value(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _count_items(value: Any) -> int:
    if isinstance(value, list):
        return len(value)
    if isinstance(value, dict):
        return 1
    return 0


def _count_keys(value: Any) -> int:
    if isinstance(value, dict):
        return len(value.keys())
    return 0


def _create_in_memory_bucket_controller(
    buckets: dict[str, dict[str, float]],
    message: str,
):
    class Controller:
        def check(self, key: str, config: BucketConfig) -> float:
            return _refill_bucket(buckets, key, config)

        def deduct(self, key: str, cost: float, config: BucketConfig) -> float:
            balance = _refill_bucket(buckets, key, config)
            new_balance = balance - cost
            min_balance = config.min_balance
            if new_balance < min_balance:
                deficit = min_balance - new_balance
                intervals_needed = math.ceil(deficit / config.fill_amount)
                retry_after_ms = intervals_needed * config.fill_interval
                raise HttpError(429, message, {"retry_after_ms": retry_after_ms})
            buckets[key]["balance"] = new_balance
            return new_balance

        def refund(self, key: str, cost: float, config: BucketConfig) -> None:
            if key not in buckets:
                buckets[key] = {
                    "balance": min(config.max_balance, cost),
                    "last_refill_ms": time.time() * 1000,
                }
            else:
                buckets[key]["balance"] = min(config.max_balance, buckets[key]["balance"] + cost)

    return Controller()


def _refill_bucket(buckets: dict[str, dict[str, float]], key: str, config: BucketConfig) -> float:
    now = time.time() * 1000
    bucket = buckets.get(key)
    if bucket is None:
        buckets[key] = {"balance": config.max_balance, "last_refill_ms": now}
        return config.max_balance

    elapsed_ms = now - bucket["last_refill_ms"]
    intervals_elapsed = math.floor(elapsed_ms / config.fill_interval)
    if intervals_elapsed > 0:
        generated = intervals_elapsed * config.fill_amount
        bucket["balance"] = min(config.max_balance, bucket["balance"] + generated)
        bucket["last_refill_ms"] = now
    return bucket["balance"]
