import { z } from 'zod'
import type { RouteMeta } from '../types'

/**
 * Check if a query parameter should trigger help mode
 * Returns true if help parameter is present with a truthy value or without a value
 */
export function isHelpRequested(helpParam: any, hasHelpParam: boolean): boolean {
  if (!hasHelpParam) return false
  if (helpParam === undefined || helpParam === '') return true
  if (typeof helpParam === 'string') {
    const lower = helpParam.toLowerCase()
    return lower === 'true' || lower === 't' || lower === 'yes'
  }
  return false
}

/**
 * Generate help documentation for a route
 */
export function generateRouteHelp(
  methodName: string,
  routePath: string,
  httpMethod: string,
  routeMeta: RouteMeta | undefined,
  basePath: string
): any {
  const fullPath = basePath + routePath

  // Try to extract schema shape for input documentation
  let inputDocs: any = null
  const inputSchema = routeMeta?.inputSchema
  if (inputSchema && 'shape' in inputSchema) {
    const shape = (inputSchema as any).shape
    if (shape) {
      inputDocs = Object.keys(shape).reduce((acc: any, key) => {
        const field = shape[key]
        acc[key] = {
          type: field._def?.typeName || 'unknown',
          description: field.description || '',
          required: !field.isOptional?.(),
        }
        return acc
      }, {})
    }
  }

  // Extract output schema info
  let outputDocs: any = null
  const outputSchema = routeMeta?.outputSchema
  if (outputSchema && 'shape' in outputSchema) {
    const shape = (outputSchema as any).shape
    if (shape) {
      outputDocs = Object.keys(shape).reduce((acc: any, key) => {
        const field = shape[key]
        acc[key] = {
          type: field._def?.typeName || 'unknown',
          description: field.description || '',
        }
        return acc
      }, {})
    }
  }

  return {
    method: httpMethod,
    path: fullPath,
    methodName,
    auth: routeMeta?.auth ?? 'public',
    summary: routeMeta?.summary,
    description: routeMeta?.description || 'Route documentation',
    parameters: inputDocs || 'No input schema defined',
    response: outputDocs || 'No output schema defined',
    limits: {
      rateLimit: routeMeta?.rateLimit ? true : false,
      tokenLimit: routeMeta?.tokenLimit ? true : false,
      cache: routeMeta?.cache ? true : false,
    },
  }
}

/**
 * Validate input against a Zod schema and return error if invalid
 */
export function validateInput(
  input: Record<string, any>,
  schema: z.ZodTypeAny | undefined
): { valid: boolean; error?: any } {
  if (!schema) {
    return { valid: true }
  }

  try {
    schema.parse(input)
    return { valid: true }
  } catch (err: any) {
    return {
      valid: false,
      error: {
        message: err.message,
        issues: err.issues || [],
      },
    }
  }
}
