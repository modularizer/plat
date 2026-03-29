/**
 * OpenAPI 3.x spec type definitions.
 *
 * Every piece of the spec has its own exported interface so that
 * consumers can reference exactly the part they need.
 *
 * Designed to work with both wide types (plain objects) and narrow
 * `as const` literals for full type-level inference.
 */

import type { HttpMethod } from './http'

// ── JSON Schema ────────────────────────────────────────────

export interface OpenAPISchema {
  readonly type?: string
  readonly format?: string
  readonly enum?: readonly (string | number | boolean)[]
  readonly const?: string | number | boolean
  readonly properties?: Readonly<Record<string, OpenAPISchema>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean | OpenAPISchema
  readonly items?: OpenAPISchema
  readonly prefixItems?: readonly OpenAPISchema[]
  readonly minItems?: number
  readonly maxItems?: number
  readonly uniqueItems?: boolean
  readonly minimum?: number
  readonly maximum?: number
  readonly exclusiveMinimum?: number | boolean
  readonly exclusiveMaximum?: number | boolean
  readonly multipleOf?: number
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
  readonly default?: unknown
  readonly examples?: readonly unknown[]
  readonly description?: string
  readonly title?: string
  readonly nullable?: boolean
  readonly readOnly?: boolean
  readonly writeOnly?: boolean
  readonly deprecated?: boolean
  readonly $ref?: string
  readonly allOf?: readonly OpenAPISchema[]
  readonly oneOf?: readonly OpenAPISchema[]
  readonly anyOf?: readonly OpenAPISchema[]
  readonly not?: OpenAPISchema
  readonly discriminator?: OpenAPIDiscriminator
}

export interface OpenAPIDiscriminator {
  readonly propertyName: string
  readonly mapping?: Readonly<Record<string, string>>
}

// ── Parameters ─────────────────────────────────────────────

export interface OpenAPIParameter {
  readonly name: string
  readonly in: 'query' | 'path' | 'header' | 'cookie' | string
  readonly required?: boolean
  readonly deprecated?: boolean
  readonly description?: string
  readonly schema?: OpenAPISchema
  readonly style?: string
  readonly explode?: boolean
  readonly example?: unknown
  readonly examples?: Readonly<Record<string, OpenAPIExample>>
}

export interface OpenAPIExample {
  readonly summary?: string
  readonly description?: string
  readonly value?: unknown
  readonly externalValue?: string
}

// ── Request Body ───────────────────────────────────────────

export interface OpenAPIRequestBody {
  readonly description?: string
  readonly required?: boolean
  readonly content: Readonly<Record<string, OpenAPIMediaType>>
}

export interface OpenAPIMediaType {
  readonly schema?: OpenAPISchema
  readonly example?: unknown
  readonly examples?: Readonly<Record<string, OpenAPIExample>>
  readonly encoding?: Readonly<Record<string, OpenAPIEncoding>>
}

export interface OpenAPIEncoding {
  readonly contentType?: string
  readonly headers?: Readonly<Record<string, OpenAPIHeader>>
  readonly style?: string
  readonly explode?: boolean
  readonly allowReserved?: boolean
}

// ── Responses ──────────────────────────────────────────────

export interface OpenAPIResponse {
  readonly description?: string
  readonly headers?: Readonly<Record<string, OpenAPIHeader>>
  readonly content?: Readonly<Record<string, OpenAPIMediaType>>
  readonly links?: Readonly<Record<string, OpenAPILink>>
}

export interface OpenAPIHeader {
  readonly description?: string
  readonly required?: boolean
  readonly deprecated?: boolean
  readonly schema?: OpenAPISchema
}

export interface OpenAPILink {
  readonly operationRef?: string
  readonly operationId?: string
  readonly parameters?: Readonly<Record<string, unknown>>
  readonly requestBody?: unknown
  readonly description?: string
  readonly server?: OpenAPIServer
}

// ── Operation ──────────────────────────────────────────────

export interface OpenAPIOperation {
  readonly operationId?: string
  readonly summary?: string
  readonly description?: string
  readonly tags?: readonly string[]
  readonly deprecated?: boolean
  readonly parameters?: readonly OpenAPIParameter[]
  readonly requestBody?: OpenAPIRequestBody
  readonly responses: Readonly<Record<string, OpenAPIResponse>>
  readonly security?: readonly OpenAPISecurityRequirement[]
  readonly servers?: readonly OpenAPIServer[]
  readonly callbacks?: Readonly<Record<string, OpenAPIPathItem>>
  readonly externalDocs?: OpenAPIExternalDocs
}

// ── Path Item ──────────────────────────────────────────────

export interface OpenAPIPathItem {
  readonly summary?: string
  readonly description?: string
  readonly get?: OpenAPIOperation
  readonly post?: OpenAPIOperation
  readonly put?: OpenAPIOperation
  readonly patch?: OpenAPIOperation
  readonly delete?: OpenAPIOperation
  readonly options?: OpenAPIOperation
  readonly head?: OpenAPIOperation
  readonly trace?: OpenAPIOperation
  readonly parameters?: readonly OpenAPIParameter[]
  readonly servers?: readonly OpenAPIServer[]
}

// ── Components ─────────────────────────────────────────────

export interface OpenAPIComponents {
  readonly schemas?: Readonly<Record<string, OpenAPISchema>>
  readonly responses?: Readonly<Record<string, OpenAPIResponse>>
  readonly parameters?: Readonly<Record<string, OpenAPIParameter>>
  readonly examples?: Readonly<Record<string, OpenAPIExample>>
  readonly requestBodies?: Readonly<Record<string, OpenAPIRequestBody>>
  readonly headers?: Readonly<Record<string, OpenAPIHeader>>
  readonly securitySchemes?: Readonly<Record<string, OpenAPISecurityScheme>>
  readonly links?: Readonly<Record<string, OpenAPILink>>
  readonly callbacks?: Readonly<Record<string, OpenAPIPathItem>>
  readonly pathItems?: Readonly<Record<string, OpenAPIPathItem>>
}

// ── Security ───────────────────────────────────────────────

export interface OpenAPISecurityScheme {
  readonly type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | string
  readonly description?: string
  readonly name?: string
  readonly in?: 'query' | 'header' | 'cookie' | string
  readonly scheme?: string
  readonly bearerFormat?: string
  readonly flows?: OpenAPIOAuthFlows
  readonly openIdConnectUrl?: string
}

export interface OpenAPIOAuthFlows {
  readonly implicit?: OpenAPIOAuthFlow
  readonly password?: OpenAPIOAuthFlow
  readonly clientCredentials?: OpenAPIOAuthFlow
  readonly authorizationCode?: OpenAPIOAuthFlow
}

export interface OpenAPIOAuthFlow {
  readonly authorizationUrl?: string
  readonly tokenUrl?: string
  readonly refreshUrl?: string
  readonly scopes: Readonly<Record<string, string>>
}

export type OpenAPISecurityRequirement = Readonly<Record<string, readonly string[]>>

// ── Top-level ──────────────────────────────────────────────

export interface OpenAPIInfo {
  readonly title: string
  readonly version: string
  readonly description?: string
  readonly termsOfService?: string
  readonly contact?: OpenAPIContact
  readonly license?: OpenAPILicense
  readonly summary?: string
}

export interface OpenAPIContact {
  readonly name?: string
  readonly url?: string
  readonly email?: string
}

export interface OpenAPILicense {
  readonly name: string
  readonly identifier?: string
  readonly url?: string
}

export interface OpenAPIServer {
  readonly url: string
  readonly description?: string
  readonly variables?: Readonly<Record<string, OpenAPIServerVariable>>
}

export interface OpenAPIServerVariable {
  readonly enum?: readonly string[]
  readonly default: string
  readonly description?: string
}

export interface OpenAPIExternalDocs {
  readonly url: string
  readonly description?: string
}

export interface OpenAPITag {
  readonly name: string
  readonly description?: string
  readonly externalDocs?: OpenAPIExternalDocs
}

/** Full OpenAPI 3.x specification */
export interface OpenAPISpec {
  readonly openapi: string
  readonly info: OpenAPIInfo
  readonly jsonSchemaDialect?: string
  readonly servers?: readonly OpenAPIServer[]
  readonly paths?: Readonly<Record<string, OpenAPIPathItem>>
  readonly webhooks?: Readonly<Record<string, OpenAPIPathItem>>
  readonly components?: OpenAPIComponents
  readonly security?: readonly OpenAPISecurityRequirement[]
  readonly tags?: readonly OpenAPITag[]
  readonly externalDocs?: OpenAPIExternalDocs
}
