const controllers = new WeakMap();
const METADATA_KEY = Symbol('plat:controller');
export function getControllerMeta(ctor) {
    // Try WeakMap first
    let meta = controllers.get(ctor);
    if (meta) {
        return meta;
    }
    // Fall back to property on the class
    meta = ctor[METADATA_KEY];
    if (meta) {
        return meta;
    }
    return undefined;
}
export function ensureControllerMeta(ctor) {
    let meta = controllers.get(ctor);
    if (!meta) {
        meta = {
            basePath: '',
            routes: new Map(),
        };
        controllers.set(ctor, meta);
        ctor[METADATA_KEY] = meta;
    }
    return meta;
}
export function ensureRouteMeta(ctor, key) {
    const ctrl = ensureControllerMeta(ctor);
    let route = ctrl.routes.get(key);
    if (!route) {
        route = { name: String(key) };
        ctrl.routes.set(key, route);
    }
    return route;
}
//# sourceMappingURL=metadata.js.map