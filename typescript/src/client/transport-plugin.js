export async function executeClientTransportPlugin(plugin, request) {
    const connection = plugin.connect ? await plugin.connect(request) : undefined;
    try {
        if (plugin.onConnect) {
            await plugin.onConnect(connection, request);
        }
        await plugin.sendRequest(connection, request);
        if (plugin.getUpdate) {
            while (true) {
                const update = await plugin.getUpdate(connection, request);
                if (!update)
                    break;
                await request.onEvent?.({
                    id: update.id,
                    event: update.event,
                    data: update.data,
                });
                if (plugin.onUpdate) {
                    await plugin.onUpdate(connection, update, request);
                }
            }
        }
        const result = await plugin.getResult(connection, request);
        if (plugin.onResult) {
            await plugin.onResult(connection, result, request);
        }
        if (!result.ok)
            throw result.error;
        return result.result;
    }
    finally {
        if (plugin.disconnect) {
            await plugin.disconnect(connection, request);
        }
        if (plugin.onDisconnect) {
            await plugin.onDisconnect(connection, request);
        }
    }
}
//# sourceMappingURL=transport-plugin.js.map