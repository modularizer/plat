/**
 * Plugin Architecture: Rate Limits, Token Limits, Caching
 */
export interface BucketConfig {
    maxBalance: number;
    fillInterval: number;
    fillAmount: number;
    refundedStatusCodes?: number[];
    refundSuccessful?: boolean;
    minBalance?: number;
}
export interface RateLimitEntry {
    key?: string;
    cost?: number;
    config?: BucketConfig;
}
export type RateLimitMeta = RateLimitEntry | RateLimitEntry[];
export interface ResolvedRateLimitEntry {
    key: string;
    cost: number;
    config: BucketConfig;
}
export interface RateLimitContext {
    entries: ResolvedRateLimitEntry[];
    remainingBalances: number[];
}
export interface RateLimitController {
    check(key: string, config: BucketConfig): Promise<number> | number;
    deduct(key: string, cost: number, config: BucketConfig): Promise<number> | number;
    refund(key: string, cost: number, config: BucketConfig): Promise<void> | void;
}
export interface TokenCallCostFormula {
    initial?: number;
    perLimit?: number;
    perChar?: number;
}
export interface TokenResponseCostFormula {
    perMs?: number;
    perItem?: number;
    perChar?: number;
    perKey?: number;
}
export interface TokenLimitEntry {
    key?: string;
    callCost?: number | TokenCallCostFormula | ((params: any, ctx: any) => number | Promise<number>);
    responseCost?: number | TokenResponseCostFormula | ((result: any, timing: TokenLimitTiming, params: any) => number | Promise<number>);
    failureCost?: number | ((error: Error, timing: TokenLimitTiming, params: any) => number | Promise<number>);
    config?: BucketConfig;
}
export type TokenLimitMeta = TokenLimitEntry | TokenLimitEntry[];
export interface TokenLimitTiming {
    startMs: number;
    endMs: number;
    durationMs: number;
}
export interface ResolvedTokenLimitEntry {
    key: string;
    callCost: number;
    responseCostSpec: TokenLimitEntry['responseCost'];
    failureCostSpec: TokenLimitEntry['failureCost'];
    config: BucketConfig;
}
export interface TokenLimitContext {
    entries: ResolvedTokenLimitEntry[];
    remainingBalances: number[];
    responseCosts?: number[];
    failureCosts?: number[];
    timing?: TokenLimitTiming;
}
export interface TokenLimitController {
    check(key: string, config: BucketConfig): Promise<number> | number;
    deduct(key: string, cost: number, config: BucketConfig): Promise<number> | number;
    refund(key: string, cost: number, config: BucketConfig): Promise<void> | void;
}
export interface CacheEntry {
    key: string;
    ttl?: number;
    methods?: string[];
}
export type CacheMeta = CacheEntry | CacheEntry[];
export interface CacheContext {
    key: string | null;
    hit: boolean;
    stored: boolean;
}
export type RateLimitConfigs = Record<string, BucketConfig>;
export type TokenLimitConfigs = Record<string, BucketConfig>;
export interface CacheController {
    get(key: string): Promise<any> | any;
    set(key: string, value: any, ttlSeconds?: number): Promise<void> | void;
    clear(key: string): Promise<void> | void;
}
//# sourceMappingURL=plugins.d.ts.map