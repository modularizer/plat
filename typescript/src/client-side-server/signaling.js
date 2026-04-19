export function parseClientSideServerAddress(input) {
    const url = new URL(input);
    if (url.protocol !== 'css:') {
        throw new Error(`Client-side server URLs must use css://, got ${input}`);
    }
    const params = {};
    url.searchParams.forEach((value, key) => {
        params[key] = value;
    });
    return {
        href: input,
        authority: url.host,
        serverName: url.host || decodeURIComponent(url.pathname.replace(/^\/+/, '')),
        topic: decodeURIComponent(url.pathname.replace(/^\/+/, '')) || undefined,
        peerId: url.searchParams.get('peer') ?? undefined,
        params,
    };
}
export function getClientSideServerMode(input) {
    const serverName = typeof input === 'string'
        ? parseClientSideServerAddress(input).serverName
        : input.serverName;
    return serverName.startsWith('dmz/') ? 'dmz' : 'authority';
}
export function isAuthorityClientSideServerAddress(input) {
    return getClientSideServerMode(input) === 'authority';
}
export function isDmzClientSideServerAddress(input) {
    return getClientSideServerMode(input) === 'dmz';
}
//# sourceMappingURL=signaling.js.map