import { ControllerMeta, RouteMeta } from '../types/endpoints'

const controllers = new WeakMap<Function, ControllerMeta>()
const METADATA_KEY = Symbol('plat:controller')

export function getControllerMeta(ctor: Function): ControllerMeta | undefined {
  // Try WeakMap first
  let meta = controllers.get(ctor)
  if (meta) {
    return meta
  }

  // Fall back to property on the class
  meta = (ctor as any)[METADATA_KEY]
  if (meta) {
    return meta
  }

  return undefined
}

export function ensureControllerMeta(ctor: Function): ControllerMeta {
  let meta = controllers.get(ctor)
  if (!meta) {
    meta = {
      basePath: '',
      routes: new Map(),
    }
    controllers.set(ctor, meta)
    // Also store on the class for runtime access
    ;(ctor as any)[METADATA_KEY] = meta
  }
  return meta
}

export function ensureRouteMeta(
  ctor: Function,
  key: string | symbol,
): RouteMeta {
  const ctrl = ensureControllerMeta(ctor)

  let route = ctrl.routes.get(key)
  if (!route) {
    route = { name: String(key) }
    ctrl.routes.set(key, route)
  }

  return route
}
