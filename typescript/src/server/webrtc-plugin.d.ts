import { type ClientSideServerMQTTWebRTCOptions, type ClientSideServerWorkerInfo } from '../client-side-server/mqtt-webrtc';
import { type ClientSideServerInstanceInfo } from '../client-side-server/protocol';
import type { PLATServerProtocolPlugin } from './protocol-plugin';
export interface PLATServerWebRTCOptions extends ClientSideServerMQTTWebRTCOptions {
    /** css:// name this server is reachable at (e.g. "dmz/my-api" or "authority.com/my-api"). */
    name: string;
    /** Optional load-balancing/worker metadata surfaced on MQTT announcements. */
    workerInfo?: ClientSideServerWorkerInfo;
    /**
     * Optional overrides/additions to the ClientSideServerInstanceInfo
     * (version / openapiHash / etc.) published over MQTT.
     */
    instanceInfo?: ClientSideServerInstanceInfo;
}
export interface ServerInfoProvider {
    getOpenAPISpec(): Record<string, any> | undefined;
    getToolsList(): unknown[];
    getServerStartedAt(): number;
}
export declare function createWebRTCProtocolPlugin(options: PLATServerWebRTCOptions, info: ServerInfoProvider): PLATServerProtocolPlugin;
//# sourceMappingURL=webrtc-plugin.d.ts.map