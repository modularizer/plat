import { BucketConfig } from "../../types"

export const bucket = (maxBalance: number, fillAmount: number = 1, fillIntervalSeconds: number = 1, minBalance: number = 0, refundedStatusCodes = [], refundSuccessful = false): BucketConfig => ({
    maxBalance,
    fillAmount,
    fillInterval: fillIntervalSeconds * 1000,
    minBalance,
    refundedStatusCodes,
    refundSuccessful,
})

export const minBucket = (maxBalance: number, fillAmount: number = 1, fillIntervalMinutes: number = 1, minBalance: number = 0, refundedStatusCodes = [], refundSuccessful = false): BucketConfig => ({
    maxBalance,
    fillAmount,
    fillInterval: fillIntervalMinutes * 60 * 1000,
    minBalance,
    refundedStatusCodes,
    refundSuccessful,
})

export const hourBucket = (maxBalance: number, fillAmount: number = 1, fillIntervalHours: number = 1, minBalance: number = 0, refundedStatusCodes = [], refundSuccessful = false): BucketConfig => ({
    maxBalance,
    fillAmount,
    fillInterval: fillIntervalHours * 60 * 60 * 1000,
    minBalance,
    refundedStatusCodes,
    refundSuccessful,
})

export const dayBucket = (maxBalance: number, fillAmount: number = 1, fillIntervalDays: number = 1, minBalance: number = 0, refundedStatusCodes = [], refundSuccessful = false): BucketConfig => ({
    maxBalance,
    fillAmount,
    fillInterval: fillIntervalDays * 60 * 60 * 24 * 1000,
    minBalance,
    refundedStatusCodes,
    refundSuccessful,
})

export const weekBucket = (maxBalance: number, fillAmount: number = 1, fillIntervalWeeks: number = 1, minBalance: number = 0, refundedStatusCodes = [], refundSuccessful = false): BucketConfig => ({
    maxBalance,
    fillAmount,
    fillInterval: fillIntervalWeeks * 60 * 60 * 24 * 7 * 1000,
    minBalance,
    refundedStatusCodes,
    refundSuccessful,
})

export const monthBucket = (maxBalance: number, fillAmount: number = 1, fillIntervalMonths: number = 1, minBalance: number = 0, refundedStatusCodes = [], refundSuccessful = false): BucketConfig => ({
    maxBalance,
    fillAmount,
    fillInterval: fillIntervalMonths * 60 * 60 * 24 * 1000 * 365.25 / 12,
    minBalance,
    refundedStatusCodes,
    refundSuccessful,
})

export const yearBucket = (maxBalance: number, fillAmount: number = 1, fillIntervalYears: number = 1, minBalance: number = 0, refundedStatusCodes = [], refundSuccessful = false): BucketConfig => ({
    maxBalance,
    fillAmount,
    fillInterval: fillIntervalYears * 60 * 60 * 24 * 365.25 * 1000,
    minBalance,
    refundedStatusCodes,
    refundSuccessful,
})