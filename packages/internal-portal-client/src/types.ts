import type { Dispatcher, RequestInfo, RequestInit, Response } from "undici";

export interface InternalPortalClientConfig {
	portalBaseUrl: string;
	portalPageUrl: string;
	proxyServer?: string | null;
	ssoCookieDomain: string;
	ssoTgc: string;
}

export interface InternalPortalApiResponse {
	bodyStream?(): AsyncIterable<Uint8Array>;
	cancelBody?(reason?: unknown): Promise<void>;
	headers?(): Record<string, string>;
	ok(): boolean;
	status(): number;
	statusText(): string;
	text(): Promise<string>;
}

export interface InternalPortalApiContext {
	dispose(): Promise<void>;
	get(path: string): Promise<InternalPortalApiResponse>;
	getSsoTgc(): string;
	post(
		path: string,
		input: {
			form: Record<string, string>;
		},
	): Promise<InternalPortalApiResponse>;
}

export interface InternalPortalAuthenticationResult {
	ssoTgc: string;
}

export type PortalRequestInit = RequestInit & {
	maxRedirect?: number;
};

export type PortalFetch = (input: RequestInfo, init?: PortalRequestInit) => Promise<Response>;

export interface CreatePortalApiContextDependencies {
	abortSignal?: AbortSignal;
	createDispatcher?: (
		proxyServer: string | null,
		timeouts: { bodyTimeout: number; headersTimeout: number },
	) => Dispatcher;
	fetch?: PortalFetch;
}
