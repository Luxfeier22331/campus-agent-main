import fs from "node:fs";

import fetchCookie from "fetch-cookie";
import {
	type Dispatcher,
	Headers,
	ProxyAgent,
	type RequestInfo,
	type RequestInit,
	type Response,
	fetch as undiciFetch,
} from "undici";
import {
	PortalCredentialExpiredError,
	PortalCredentialUnavailableError,
	PortalSessionExpiredError,
} from "./auth-errors.js";
import { type InternalPortalConfig, resolveInternalPortalConfig } from "./config.js";
import type { ApiRequestContextLike, ApiResponseLike, DisposableApiContextLike } from "./types.js";

const SSO_TGC_COOKIE_NAME = "SSO_TGC";
const MAX_AUTH_REDIRECTS = 10;
const MAX_PORTAL_REDIRECTS = 5;
const REDIRECT_LIMIT_MESSAGE = "Reached maximum redirect";

type PortalRequestInit = RequestInit & {
	maxRedirect?: number;
};

export type PortalFetch = (input: RequestInfo, init?: PortalRequestInit) => Promise<Response>;

type PortalCookieJar = InstanceType<typeof fetchCookie.toughCookie.CookieJar>;
type PortalCookieFetch = PortalFetch;

export interface CreatePortalApiContextDependencies {
	abortSignal?: AbortSignal;
	createDispatcher?: (proxyServer: string) => Dispatcher;
	fetch?: PortalFetch;
}

export async function createPortalApiContext(
	config: InternalPortalConfig = resolveInternalPortalConfig(process.env),
	dependencies: CreatePortalApiContextDependencies = {},
): Promise<ApiRequestContextLike & DisposableApiContextLike> {
	const session = new PortalSession(config, dependencies);
	try {
		await session.initialize();
		return session;
	} catch (error) {
		await session.dispose();
		throw error;
	}
}

export async function checkPortalAuthentication(
	config: InternalPortalConfig = resolveInternalPortalConfig(process.env),
	dependencies: CreatePortalApiContextDependencies = {},
): Promise<void> {
	const session = new PortalSession(config, dependencies);
	try {
		await session.initialize();
	} finally {
		await session.dispose();
	}
}

class PortalSession implements ApiRequestContextLike, DisposableApiContextLike {
	private activeContext: ApiRequestContextLike | null = null;
	private readonly abortController = new AbortController();
	private readonly config: InternalPortalConfig;
	private readonly dependencies: CreatePortalApiContextDependencies;
	private readonly dispatcher: Dispatcher | null;
	private disposed = false;
	private readonly removeUpstreamAbortListener: () => void;

	constructor(config: InternalPortalConfig, dependencies: CreatePortalApiContextDependencies) {
		this.config = config;
		this.dependencies = dependencies;
		this.dispatcher = config.portalProxyServer
			? (dependencies.createDispatcher ?? ((server) => new ProxyAgent(server)))(
					config.portalProxyServer,
				)
			: null;
		this.removeUpstreamAbortListener = forwardAbort(dependencies.abortSignal, this.abortController);
	}

	async initialize(): Promise<void> {
		this.abortController.signal.throwIfAborted();
		this.activeContext = await bootstrapPortalSession({
			config: this.config,
			dispatcher: this.dispatcher,
			fetch: this.dependencies.fetch ?? undiciFetch,
			signal: this.abortController.signal,
		});
	}

	async get(requestPath: string): Promise<ApiResponseLike> {
		return await this.performRequest((context) => context.get(requestPath));
	}

	async post(
		requestPath: string,
		input: { form: Record<string, string> },
	): Promise<ApiResponseLike> {
		return await this.performRequest((context) => context.post(requestPath, input));
	}

	async dispose(): Promise<void> {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.removeUpstreamAbortListener();
		this.abortController.abort(new Error("internal portal HTTP session disposed"));
		this.activeContext = null;
		if (this.dispatcher) {
			await this.dispatcher.close();
		}
	}

	private async performRequest(
		operation: (context: ApiRequestContextLike) => Promise<ApiResponseLike>,
	): Promise<ApiResponseLike> {
		this.abortController.signal.throwIfAborted();
		const response = await operation(this.requireContext());
		if (isAuthHttpStatus(response.status())) {
			await response.cancelBody?.("portal authentication response rejected");
			throw new PortalSessionExpiredError(
				`internal portal API session expired: ${response.status()} ${response.statusText()}`,
			);
		}
		return response;
	}

	private requireContext(): ApiRequestContextLike {
		if (!this.activeContext) {
			throw new Error("internal portal API context is not initialized");
		}
		return this.activeContext;
	}
}

async function bootstrapPortalSession(input: {
	config: InternalPortalConfig;
	dispatcher: Dispatcher | null;
	fetch: PortalFetch;
	signal: AbortSignal;
}): Promise<ApiRequestContextLike> {
	const ssoTgc = resolveSsoTgc(input.config);
	const cookieDomain = input.config.authSsoCookieDomain;
	if (!cookieDomain) {
		throw new PortalCredentialUnavailableError(
			"INTERNAL_PORTAL_SSO_COOKIE_DOMAIN is required for internal portal authentication",
		);
	}
	const jar = new fetchCookie.toughCookie.CookieJar(undefined, {
		looseMode: false,
		rejectPublicSuffixes: true,
	});
	await seedSsoTgc({
		cookieDomain,
		jar,
		portalBaseUrl: input.config.portalBaseUrl,
		ssoTgc,
	});

	let serviceTicketIssued = false;
	const bootstrapFetch = createCookieFetch({
		assertUrl: (url) => {
			assertBootstrapUrlAllowed(url, input.config);
			if (
				url.hostname === new URL(input.config.portalBaseUrl).hostname &&
				url.searchParams.get("ticket")?.startsWith("ST-")
			) {
				serviceTicketIssued = true;
			}
		},
		dispatcher: input.dispatcher,
		fetch: input.fetch,
		jar,
		normalizeRedirectUrl: (url) => normalizeBootstrapRedirectUrl(url, input.config),
		signal: input.signal,
	});
	const navigationResponse = await bootstrapFetch(input.config.portalBaseUrl, {
		headers: buildPortalNavigationHeaders(),
		maxRedirect: MAX_AUTH_REDIRECTS,
		method: "GET",
		redirect: "follow",
		signal: input.signal,
	});
	const finalUrl = new URL(navigationResponse.url);
	await navigationResponse.body?.cancel("portal SSO navigation complete");
	if (!navigationResponse.ok) {
		throw classifyBootstrapHttpError(
			navigationResponse.status,
			navigationResponse.statusText,
			"portal SSO navigation",
		);
	}
	if (
		finalUrl.protocol !== "https:" ||
		finalUrl.hostname !== new URL(input.config.portalBaseUrl).hostname
	) {
		throw new PortalCredentialExpiredError("portal SSO did not return to the portal host");
	}
	if (!serviceTicketIssued) {
		throw new PortalCredentialExpiredError("portal SSO did not issue a service ticket");
	}

	return createPortalRequestContext({
		config: input.config,
		dispatcher: input.dispatcher,
		fetch: input.fetch,
		jar,
		signal: input.signal,
	});
}

function createPortalRequestContext(input: {
	config: InternalPortalConfig;
	dispatcher: Dispatcher | null;
	fetch: PortalFetch;
	jar: PortalCookieJar;
	signal: AbortSignal;
}): ApiRequestContextLike {
	const portalHost = new URL(input.config.portalBaseUrl).hostname;
	const cookieFetch = createCookieFetch({
		assertUrl: (url) => {
			assertHttpsUrl(url, "internal portal API request");
			if (url.hostname !== portalHost) {
				throw new PortalCredentialExpiredError(
					"internal portal API session redirected outside the portal host",
				);
			}
		},
		dispatcher: input.dispatcher,
		fetch: input.fetch,
		jar: input.jar,
		signal: input.signal,
	});
	return {
		get: async (requestPath) =>
			toApiResponse(
				await performPortalRequest({
					config: input.config,
					cookieFetch,
					method: "GET",
					requestPath,
					signal: input.signal,
				}),
			),
		post: async (requestPath, requestInput) =>
			toApiResponse(
				await performPortalRequest({
					config: input.config,
					cookieFetch,
					form: requestInput.form,
					method: "POST",
					requestPath,
					signal: input.signal,
				}),
			),
	};
}

async function performPortalRequest(input: {
	config: InternalPortalConfig;
	cookieFetch: PortalCookieFetch;
	form?: Record<string, string>;
	method: "GET" | "POST";
	requestPath: string;
	signal: AbortSignal;
}): Promise<Response> {
	const url = new URL(input.requestPath, input.config.portalBaseUrl);
	try {
		return await input.cookieFetch(url, {
			body: input.form ? new URLSearchParams(input.form).toString() : undefined,
			headers: buildPortalApiHeaders(input.config),
			maxRedirect: MAX_PORTAL_REDIRECTS,
			method: input.method,
			redirect: "follow",
			signal: input.signal,
		});
	} catch (error) {
		if (isRedirectLimitError(error)) {
			throw new PortalCredentialExpiredError("internal portal API exceeded the redirect limit", {
				cause: error,
			});
		}
		throw error;
	}
}

function createCookieFetch(input: {
	assertUrl: (url: URL) => void;
	dispatcher: Dispatcher | null;
	fetch: PortalFetch;
	jar: PortalCookieJar;
	normalizeRedirectUrl?: (url: URL) => URL;
	signal: AbortSignal;
}): PortalCookieFetch {
	const guardedFetch: PortalFetch = async (requestInput, requestInit = {}) => {
		const url = requestUrl(requestInput);
		input.assertUrl(url);
		const signal = mergeAbortSignals(input.signal, requestInit.signal);
		return await input.fetch(requestInput, {
			...requestInit,
			...(input.dispatcher ? { dispatcher: input.dispatcher } : {}),
			redirect: "manual",
			signal,
		});
	};
	const cookieFetch = fetchCookie<RequestInfo, PortalRequestInit, Response>(
		guardedFetch,
		input.jar,
		false,
	);
	return async (requestInput, requestInit = {}) =>
		await fetchWithBoundedRedirects({
			fetch: cookieFetch,
			normalizeRedirectUrl: input.normalizeRedirectUrl,
			requestInit,
			requestInput,
		});
}

async function fetchWithBoundedRedirects(input: {
	fetch: ReturnType<typeof fetchCookie<RequestInfo, PortalRequestInit, Response>>;
	normalizeRedirectUrl?: (url: URL) => URL;
	requestInit: PortalRequestInit;
	requestInput: RequestInfo;
}): Promise<Response> {
	const redirectMode = input.requestInit.redirect ?? "follow";
	const maxRedirect = input.requestInit.maxRedirect ?? 20;
	let currentInput = input.requestInput;
	let currentInit: PortalRequestInit = { ...input.requestInit, redirect: "manual" };
	let redirectCount = 0;

	for (;;) {
		const response = await input.fetch(currentInput, currentInit);
		if (!isRedirectStatus(response.status)) {
			return response;
		}
		if (redirectMode === "manual") {
			return response;
		}
		if (redirectMode === "error") {
			await response.body?.cancel("portal redirect rejected");
			throw new TypeError(
				`URI requested responded with a redirect and redirect mode is set to error: ${response.url}`,
			);
		}

		const location = response.headers.get("location");
		if (!location) {
			return response;
		}
		if (redirectCount >= maxRedirect) {
			await response.body?.cancel("portal redirect limit exceeded");
			throw new TypeError(`${REDIRECT_LIMIT_MESSAGE} of ${maxRedirect} for URL: ${response.url}`);
		}

		const responseUrl = response.url || requestUrl(currentInput).toString();
		await response.body?.cancel("following portal redirect");
		const resolvedRedirectUrl = new URL(location, responseUrl);
		const redirectUrl = input.normalizeRedirectUrl
			? input.normalizeRedirectUrl(resolvedRedirectUrl)
			: resolvedRedirectUrl;
		currentInit = redirectRequestInit(currentInit, response.status);
		currentInput = redirectUrl;
		redirectCount += 1;
	}
}

function redirectRequestInit(init: PortalRequestInit, status: number): PortalRequestInit {
	const method = init.method?.toUpperCase();
	if (status !== 303 && !((status === 301 || status === 302) && method === "POST")) {
		return init;
	}
	const headers = new Headers(init.headers);
	headers.delete("content-length");
	headers.delete("content-type");
	return {
		...init,
		body: undefined,
		headers,
		method: "GET",
	};
}

function isRedirectStatus(status: number): boolean {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function classifyBootstrapHttpError(status: number, statusText: string, operation: string): Error {
	if (status === 401 || status === 403) {
		return new PortalCredentialExpiredError(`${operation} failed: ${status} ${statusText}`);
	}
	return new Error(`${operation} failed: ${status} ${statusText}`);
}

function resolveSsoTgc(config: InternalPortalConfig): string {
	if (config.authSsoTgc) {
		return validateSsoTgc(config.authSsoTgc);
	}
	if (!config.authSsoTgcFile) {
		throw new PortalCredentialUnavailableError(
			"INTERNAL_PORTAL_SSO_TGC or INTERNAL_PORTAL_SSO_TGC_FILE is required",
		);
	}
	return readSsoTgcFile(config.authSsoTgcFile);
}

function readSsoTgcFile(filePath: string): string {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf-8");
	} catch (error) {
		throw new PortalCredentialUnavailableError(
			`internal portal SSO credential file is unavailable: ${filePath}`,
			{ cause: error },
		);
	}
	return validateSsoTgc(raw.trim());
}

export function validateSsoTgc(value: string): string {
	if (!value) {
		throw new PortalCredentialUnavailableError("internal portal SSO_TGC is empty");
	}
	if (value.startsWith(`${SSO_TGC_COOKIE_NAME}=`)) {
		throw new PortalCredentialUnavailableError(
			"internal portal credential must contain only the raw SSO_TGC value",
		);
	}
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (
			code < 0x21 ||
			code > 0x7e ||
			code === 0x22 ||
			code === 0x2c ||
			code === 0x3b ||
			code === 0x5c
		) {
			throw new PortalCredentialUnavailableError(
				"internal portal credential must contain only the raw SSO_TGC value",
			);
		}
	}
	return value;
}

async function seedSsoTgc(input: {
	cookieDomain: string;
	jar: PortalCookieJar;
	portalBaseUrl: string;
	ssoTgc: string;
}): Promise<void> {
	await input.jar.setCookie(
		`${SSO_TGC_COOKIE_NAME}=${input.ssoTgc}; Domain=${input.cookieDomain}; Path=/; Secure; HttpOnly; SameSite=Lax`,
		input.portalBaseUrl,
		{ ignoreError: false },
	);
}

function normalizeBootstrapRedirectUrl(url: URL, config: InternalPortalConfig): URL {
	const portalUrl = new URL(config.portalBaseUrl);
	if (
		url.protocol === "http:" &&
		url.hostname === portalUrl.hostname &&
		(url.port === "" || url.port === "80") &&
		!url.username &&
		!url.password
	) {
		const normalized = new URL(url);
		normalized.protocol = "https:";
		normalized.port = portalUrl.port;
		return normalized;
	}
	return url;
}

function assertBootstrapUrlAllowed(url: URL, config: InternalPortalConfig): void {
	assertHttpsUrl(url, "internal portal SSO redirect");
	const portalHost = new URL(config.portalBaseUrl).hostname;
	if (url.hostname === portalHost) {
		return;
	}
	const cookieDomain = config.authSsoCookieDomain?.replace(/^\./, "").toLowerCase();
	if (
		cookieDomain &&
		(url.hostname === cookieDomain || url.hostname.endsWith(`.${cookieDomain}`))
	) {
		return;
	}
	throw new PortalCredentialExpiredError(
		"internal portal SSO redirected outside the configured authentication boundary",
	);
}

function assertHttpsUrl(url: URL, operation: string): void {
	if (url.protocol !== "https:" || url.username || url.password) {
		throw new PortalCredentialExpiredError(`${operation} requires a credential-free HTTPS URL`);
	}
}

function requestUrl(input: RequestInfo): URL {
	if (typeof input === "string") {
		return new URL(input);
	}
	return "url" in input ? new URL(input.url) : new URL(String(input));
}

function mergeAbortSignals(
	sessionSignal: AbortSignal,
	requestSignal?: AbortSignal | null,
): AbortSignal {
	if (!requestSignal || requestSignal === sessionSignal) {
		return sessionSignal;
	}
	return AbortSignal.any([sessionSignal, requestSignal]);
}

function forwardAbort(source: AbortSignal | undefined, target: AbortController): () => void {
	if (!source) {
		return () => undefined;
	}
	if (source.aborted) {
		target.abort(source.reason);
		return () => undefined;
	}
	const abort = () => target.abort(source.reason);
	source.addEventListener("abort", abort, { once: true });
	return () => source.removeEventListener("abort", abort);
}

function toApiResponse(response: Response): ApiResponseLike {
	return {
		bodyStream: response.body
			? () => response.body as unknown as AsyncIterable<Uint8Array>
			: undefined,
		cancelBody: response.body
			? async (reason) => {
					await response.body?.cancel(reason);
				}
			: undefined,
		headers: () => Object.fromEntries(response.headers.entries()),
		ok: () => response.ok,
		status: () => response.status,
		statusText: () => response.statusText,
		text: async () => await response.text(),
	};
}

function isAuthHttpStatus(status: number): boolean {
	return status === 401 || status === 403;
}

function buildPortalNavigationHeaders(): Record<string, string> {
	return {
		accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"user-agent": "campus-agent-source-collector/1.0",
	};
}

function buildPortalApiHeaders(config: InternalPortalConfig): Record<string, string> {
	return {
		"x-requested-with": "XMLHttpRequest",
		accept: "application/json, text/plain, */*",
		"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
		referer: config.portalPageUrl.replace(/#.*$/, ""),
	};
}

function isRedirectLimitError(error: unknown): boolean {
	return error instanceof TypeError && error.message.includes(REDIRECT_LIMIT_MESSAGE);
}
