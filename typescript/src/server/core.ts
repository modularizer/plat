import { createToolDefinition } from './tools'
import { generateRouteVariants } from './routing'
import { ensureControllerMeta, ensureRouteMeta, getControllerMeta, pendingRoutes, ROUTE_METADATA_KEY } from '../spec'
import type { ControllerMeta, RouteMeta } from '../types/endpoints'
import type { PLATServerResolvedOperation } from './transports'
import { PLATOperationRegistry } from './operation-registry'
import { isStaticFolder, type StaticFolder } from '../static/static-folder'

interface PLATServerCoreOptions {
  undecoratedMode?: 'GET' | 'POST' | 'private'
  allowedMethodPrefixes?: '*' | string[]
  disAllowedMethodPrefixes?: string[]
  validateRouteOpts?: (opts: Record<string, any>, methodName: string, path: string) => void | Promise<void>
}

export interface RegisteredStaticFolder {
  name: string
  folder: StaticFolder
  controllerTag: string
}

interface PLATServerCoreStores {
  routes: Array<{ method: string; path: string; methodName?: string }>
  tools: Map<string, any>
  operationRegistry: PLATOperationRegistry
  registeredMethodNames: Set<string>
  registeredControllerNames: Set<string>
  staticFolders: RegisteredStaticFolder[]
}

export interface RegisteredControllerOperation {
  operation: PLATServerResolvedOperation
  route: { method: string; path: string; methodName: string }
  variants: Array<{ method: string; path: string }>
}

const RESERVED_METHOD_NAMES = ['tools', 'routes', 'endpoints', 'help', 'openapi']

export class PLATServerCore {
  constructor(
    private options: PLATServerCoreOptions,
    private stores: PLATServerCoreStores,
  ) {}

  registerControllers(...ControllerClasses: (new () => any)[]): RegisteredControllerOperation[] {
    const registered: RegisteredControllerOperation[] = []

    for (const ControllerClass of ControllerClasses) {
      const meta = getControllerMeta(ControllerClass as Function) ?? ensureControllerMeta(ControllerClass as Function)
      if (!meta.basePath) meta.basePath = ControllerClass.name
      if (!meta.tag) meta.tag = meta.basePath || ControllerClass.name

      const instance = new ControllerClass()
      const controllerTag = meta.tag || meta.basePath || ControllerClass.name
      const lowerControllerTag = controllerTag.toLowerCase()
      if (RESERVED_METHOD_NAMES.includes(lowerControllerTag)) {
        throw new Error(
          `Controller '${controllerTag}' uses a reserved plat system name. ` +
          `Reserved names: ${RESERVED_METHOD_NAMES.join(', ')}. ` +
          `Choose a different controller name/tag.`
        )
      }
      if (this.stores.registeredMethodNames.has(controllerTag)) {
        throw new Error(
          `Controller '${controllerTag}' conflicts with an existing method name. ` +
          `Controller names and method names must not overlap. ` +
          `Rename either the controller or the method.`
        )
      }
      this.stores.registeredControllerNames.add(controllerTag)

      // Scan instance properties for StaticFolder class variables
      this.collectStaticFolders(instance, controllerTag)

      this.processPendingRoutes(ControllerClass)
      const freshMeta = getControllerMeta(ControllerClass as Function)
      const routes = this.collectRoutes(ControllerClass, freshMeta)

      for (const [key, route] of routes.entries()) {
        const methodName = String(key)
        this.validateMethodName(methodName, ControllerClass.name)

        if (this.stores.registeredControllerNames.has(methodName)) {
          throw new Error(
            `Method '${methodName}' in ${ControllerClass.name} conflicts with controller name '${methodName}'. ` +
            `Method names and controller names must not overlap. ` +
            `Rename either the method or the controller.`
          )
        }
        if (this.stores.registeredMethodNames.has(methodName)) {
          throw new Error(
            `Duplicate operationId: method "${methodName}" is defined in multiple controllers. ` +
            `In plat, method names must be globally unique across all controllers. ` +
            `Consider renaming one of these methods to have a unique name. ` +
            `Current controller: ${ControllerClass.name}`
          )
        }
        this.stores.registeredMethodNames.add(methodName)

        const fullPath = '/' + methodName
        const routeMeta = freshMeta?.routes.get(key)
        this.stores.tools.set(methodName, createToolDefinition({
          name: methodName,
          summary: routeMeta?.summary ?? routeMeta?.opts?.summary,
          description: routeMeta?.description ?? routeMeta?.opts?.description ?? `${route.method.toUpperCase()} ${fullPath}`,
          method: route.method,
          path: fullPath,
          controller: controllerTag,
          tags: [
            controllerTag,
            ...((Array.isArray(routeMeta?.opts?.tags) ? routeMeta?.opts?.tags : []) as string[]),
          ].filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index),
          examples: Array.isArray(routeMeta?.opts?.examples) ? routeMeta?.opts?.examples : undefined,
          hidden: routeMeta?.opts?.hidden === true,
          safe: routeMeta?.opts?.safe ?? ['GET', 'HEAD'].includes(route.method.toUpperCase()),
          idempotent: routeMeta?.opts?.idempotent ?? ['GET', 'HEAD', 'PUT', 'DELETE'].includes(route.method.toUpperCase()),
          longRunning: routeMeta?.opts?.longRunning === true,
          input_schema: routeMeta?.inputSchema ? createToolDefinition(
            methodName,
            route.method,
            fullPath,
            '',
            routeMeta.inputSchema,
          ).input_schema : undefined,
          response_schema: routeMeta?.outputSchema ? createToolDefinition(
            methodName,
            route.method,
            fullPath,
            '',
            undefined,
            routeMeta.outputSchema,
          ).response_schema : undefined,
        }))

        const operation: PLATServerResolvedOperation = {
          method: route.method.toUpperCase(),
          path: fullPath,
          methodName,
          boundMethod: (instance as any)[methodName].bind(instance),
          controllerTag,
          routeMeta,
          controllerMeta: freshMeta,
        }
        this.stores.operationRegistry.register(operation)

        const routeRecord = {
          method: route.method.toUpperCase(),
          path: fullPath,
          methodName,
        }
        this.stores.routes.push(routeRecord)

        registered.push({
          operation,
          route: routeRecord,
          variants: generateRouteVariants(methodName, route.method)
            .filter((variant) => !(variant.path === fullPath && variant.method === route.method.toUpperCase())),
        })
      }
    }

    return registered
  }

  private processPendingRoutes(ControllerClass: new () => any): void {
    if (!pendingRoutes.has(ControllerClass)) return
    const routes = pendingRoutes.get(ControllerClass)!
    for (const route of routes) {
      const routeMeta = ensureRouteMeta(ControllerClass as Function, route.key)
      routeMeta.method = route.method
      routeMeta.path = '/' + String(route.key)
      routeMeta.auth = route.opts?.auth
      routeMeta.rateLimit = route.opts?.rateLimit
      routeMeta.tokenLimit = route.opts?.tokenLimit
      routeMeta.cache = route.opts?.cache
      routeMeta.summary = route.opts?.summary
      routeMeta.description = route.opts?.description
      if (route.opts) {
        routeMeta.opts = route.opts
      }
    }
    pendingRoutes.delete(ControllerClass)
  }

  private collectRoutes(ControllerClass: new () => any, freshMeta?: ControllerMeta): Map<string | symbol, { method: string }> {
    const routes = new Map<string | symbol, { method: string }>()
    const undecoratedMode = this.options.undecoratedMode ?? 'POST'

    for (const key of Object.getOwnPropertyNames(ControllerClass.prototype)) {
      if (key === 'constructor') continue
      if (key.startsWith('_')) continue
      const method = ControllerClass.prototype[key]
      if (typeof method !== 'function') continue
      const routeData = method[ROUTE_METADATA_KEY]
      if (routeData) {
        routes.set(key, { method: routeData.httpMethod })
      } else if (undecoratedMode !== 'private') {
        routes.set(key, { method: undecoratedMode })
      }
    }

    if (freshMeta) {
      for (const [key, routeMeta] of freshMeta.routes.entries()) {
        const keyName = String(key)
        const prototypeMethod = (ControllerClass as any).prototype?.[keyName]
        if (typeof prototypeMethod !== 'function' || keyName === 'constructor' || keyName.startsWith('_')) {
          continue
        }

        const inferredMethod = routeMeta.method ?? (undecoratedMode !== 'private' ? undecoratedMode : undefined)
        if (!inferredMethod) continue

        routes.set(key, { method: inferredMethod })
        if (this.options.validateRouteOpts && routeMeta.opts) {
          const result = this.options.validateRouteOpts(routeMeta.opts, String(key), routeMeta.path!)
          if (result && typeof result === 'object' && 'then' in result) {
            // Keep behavior aligned with the current server host.
          }
        }
      }
    }

    return routes
  }

  private extractMethodPrefix(methodName: string): string | null {
    const standardPrefixes = ['create', 'update', 'delete', 'list', 'find', 'send', 'get', 'do']
    for (const prefix of standardPrefixes) {
      if (methodName.startsWith(prefix) && methodName.length > prefix.length) {
        const nextChar = methodName.charAt(prefix.length)
        if (nextChar === nextChar.toUpperCase()) {
          return prefix
        }
      }
    }
    for (let i = 1; i < methodName.length; i++) {
      const char = methodName.charAt(i)
      if (char === char.toUpperCase() && char !== char.toLowerCase()) {
        return methodName.substring(0, i)
      }
    }
    return methodName.length > 0 ? methodName : null
  }

  private collectStaticFolders(instance: any, controllerTag: string): void {
    for (const key of Object.keys(instance)) {
      const value = instance[key]
      if (!isStaticFolder(value)) continue

      // Static folder names must not collide with method names or controller names
      if (this.stores.registeredMethodNames.has(key)) {
        throw new Error(
          `StaticFolder '${key}' in ${controllerTag} conflicts with an existing method name. ` +
          `StaticFolder property names must be globally unique.`
        )
      }
      if (this.stores.registeredControllerNames.has(key)) {
        throw new Error(
          `StaticFolder '${key}' in ${controllerTag} conflicts with a controller name. ` +
          `StaticFolder property names must not overlap with controller names.`
        )
      }

      this.stores.registeredMethodNames.add(key)
      this.stores.staticFolders.push({ name: key, folder: value, controllerTag })
    }
  }

  private validateMethodName(methodName: string, controllerName: string): void {
    if (!methodName || methodName.length === 0) return
    const firstChar = methodName.charAt(0)

    if (firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
      throw new Error(
        `Method '${methodName}' in ${controllerName} violates plat naming convention: ` +
        `method names must start with a lowercase letter. ` +
        `Use '${firstChar.toLowerCase()}${methodName.slice(1)}' instead.`
      )
    }
    if (methodName.includes('_')) {
      const camelCase = methodName.replace(/_([a-z])/g, (_, char) => char.toUpperCase())
      throw new Error(
        `Method '${methodName}' in ${controllerName} violates plat naming convention: ` +
        `underscores are not allowed. Use camelCase instead. ` +
        `Use '${camelCase}' instead.`
      )
    }
    if (RESERVED_METHOD_NAMES.includes(methodName.toLowerCase())) {
      throw new Error(
        `Method '${methodName}' in ${controllerName} uses a reserved plat system name. ` +
        `Reserved names: ${RESERVED_METHOD_NAMES.join(', ')}. ` +
        `Choose a different method name.`
      )
    }
    if (this.options.allowedMethodPrefixes && this.options.allowedMethodPrefixes !== '*') {
      const prefix = this.extractMethodPrefix(methodName)
      if (prefix && !this.options.allowedMethodPrefixes.includes(prefix)) {
        throw new Error(
          `Method '${methodName}' in ${controllerName} uses disallowed prefix '${prefix}'. ` +
          `Allowed prefixes: ${this.options.allowedMethodPrefixes.join(', ')}. ` +
          `Rename the method to use an allowed prefix.`
        )
      }
    }
    if (this.options.disAllowedMethodPrefixes && this.options.disAllowedMethodPrefixes.length > 0) {
      const prefix = this.extractMethodPrefix(methodName)
      if (prefix && this.options.disAllowedMethodPrefixes.includes(prefix)) {
        throw new Error(
          `Method '${methodName}' in ${controllerName} uses disallowed prefix '${prefix}'. ` +
          `Disallowed prefixes: ${this.options.disAllowedMethodPrefixes.join(', ')}. ` +
          `Rename the method to use a different prefix.`
        )
      }
    }
  }
}
