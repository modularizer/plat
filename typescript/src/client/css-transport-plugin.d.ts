import type { PLATRPCResponse } from '../rpc';
import { type ClientSideServerAddress, type ClientSideServerMode } from '../client-side-server/signaling';
import type { ClientSideServerChannel } from '../client-side-server/channel';
import type { OpenAPIClientTransportPlugin, OpenAPIClientTransportRequest } from './transport-plugin';
export interface ClientSideServerConnectContext {
    address: ClientSideServerAddress;
    mode: ClientSideServerMode;
    request: OpenAPIClientTransportRequest;
}
export interface ClientSideServerTransportPluginOptions {
    connect(context: ClientSideServerConnectContext): Promise<ClientSideServerChannel> | ClientSideServerChannel;
}
interface CSSConnection {
    channel: ClientSideServerChannel;
    unsubscribe?: () => void;
    result?: PLATRPCResponse;
}
export declare function createClientSideServerTransportPlugin(options: ClientSideServerTransportPluginOptions): OpenAPIClientTransportPlugin<CSSConnection>;
export {};
//# sourceMappingURL=css-transport-plugin.d.ts.map