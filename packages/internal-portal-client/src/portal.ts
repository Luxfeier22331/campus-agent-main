import fetchCookie from "fetch-cookie";
import {
	type Dispatcher,
	Headers,
	ProxyAgent,
	type RequestInfo,
	type Response,
	fetch as undiciFetch,
} from "undici";
import {
	PortalCredentialExpiredError,
	PortalCredentialUnavailableError,
	PortalSessionExpiredError,
} from "./errors.ts";
import type {
	CreatePortalApiContextDependencies,
	InternalPortalApiContext,
	InternalPortalApiResponse,
	InternalPortalAuthenticationResult,
	InternalPortalClientConfig,
	PortalFetch,
	PortalRequestInit,
} from "./types.ts";

const SSO_TGC_COOKIE_NAME = "SSO_TGC";
const MAX_AUTH_REDIRECTS = 10;
const MAX_PORTAL_REDIRECTS = 5;
const REDIRECT_LIMIT_MESSAGE = "Reached maximum redirect";

type PortalCookieJar = InstanceType<typeof fetchCookie.toughCookie.CookieJar>;
type PortalCookieFetch = PortalFetch;

export async function createPortalApiContext(
	config: InternalPortalClientConfig,
	dependencies: CreatePortalApiContextDependencies = {},
): Promise<InternalPortalApiContext> {
	const session = new PortalSession(normalizeClientConfig(config), dependencies);
	try {
		await session.initialize();
		return session;
	} catch (error) {
		await session.dispose();
		throw error;
	}
}

export async function checkPortalAuthentication(
	config: InternalPortalClientConfig,
	dependencies: CreatePortalApiContextDependencies = {},
): Promise<InternalPortalAuthenticationResult> {
	const session = new PortalSession(normalizeClientConfig(config), dependencies);
	try {
		await session.initialize();
		return { ssoTgc: session.getSsoTgc() };
	} finally {
		await session.dispose();
	}
}

class PortalSession implements InternalPortalApiContext {
	private activeContext: Omit<InternalPortalApiContext, "dispose" | "getSsoTgc"> | null = null;
	private readonly abortController = new AbortController();
	private readonly config: InternalPortalClientConfig;
	private readonly dependencies: CreatePortalApiContextDependencies;
	private readonly dispatcher: Dispatcher | null;
	private disposed = false;
	private readonly removeUpstreamAbortListener: () => void;
	private ssoTgc: string;

	constructor(
		config: InternalPortalClientConfig,
		dependencies: CreatePortalApiContextDependencies,
	) {
		this.config = config;
		this.dependencies = dependencies;
		this.ssoTgc = config.ssoTgc;
		this.dispatcher = config.proxyServer
			? (dependencies.createDispatcher ?? ((server) => new ProxyAgent(server)))(config.proxyServer)
			: null;
		this.removeUpstreamAbortListener = forwardAbort(dependencies.abortSignal, this.abortController);
	}

	async initialize(): Promise<void> {
		this.abortController.signal.throwIfAborted();
		const established = await bootstrapPortalSession({
			config: this.config,
			dispatcher: this.dispatcher,
			fetch: this.dependencies.fetch ?? undiciFetch,
			signal: this.abortController.signal,
		});
		this.activeContext = established.context;
		this.ssoTgc = established.ssoTgc;
	}

	async get(requestPath: string): Promise<InternalPortalApiResponse> {
		return await this.performRequest((context) => context.get(requestPath));
	}

	getSsoTgc(): string {
		return this.ssoTgc;
	}

	async post(
		requestPath: string,
		input: { form: Record<string, string> },
	): Promise<InternalPortalApiResponse> {
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
		operation: (
			context: Omit<InternalPortalApiContext, "dispose" | "getSsoTgc">,
		) => Promise<InternalPortalApiResponse>,
	): Promise<InternalPortalApiResponse> {
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

	private requireContext(): Omit<InternalPortalApiContext, "dispose" | "getSsoTgc"> {
		if (!this.activeContext) {
			throw new Error("internal portal API context is not initialized");
		}
		return this.activeContext;
	}
}

async function bootstrapPortalSession(input: {
	config: InternalPortalClientConfig;
	dispatcher: Dispatcher | null;
	fetch: PortalFetch;
	signal: AbortSignal;
}): Promise<{
	context: Omit<InternalPortalApiContext, "dispose" | "getSsoTgc">;
	ssoTgc: string;
}> {
	const jar = new fetchCookie.toughCookie.CookieJar(undefined, {
		looseMode: false,
		rejectPublicSuffixes: true,
	});
	await seedSsoTgc({
		cookieDomain: input.config.ssoCookieDomain,
		jar,
		portalBaseUrl: input.config.portalBaseUrl,
		ssoTgc: input.config.ssoTgc,
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

	return {
		context: createPortalRequestContext({
			config: input.config,
			dispatcher: input.dispatcher,
			fetch: input.fetch,
			jar,
			signal: input.signal,
		}),
		ssoTgc: await resolveCurrentSsoTgc(jar, input.config),
	};
}

function createPortalRequestContext(input: {
	config: InternalPortalClientConfig;
	dispatcher: Dispatcher | null;
	fetch: PortalFetch;
	jar: PortalCookieJar;
	signal: AbortSignal;
}): Omit<InternalPortalApiContext, "dispose" | "getSsoTgc"> {
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
	config: InternalPortalClientConfig;
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

async function resolveCurrentSsoTgc(
	jar: PortalCookieJar,
	config: InternalPortalClientConfig,
): Promise<string> {
	const cookies = await jar.getCookies(config.portalBaseUrl);
	const current = cookies.find((cookie) => cookie.key === SSO_TGC_COOKIE_NAME)?.value;
	return current ? validateSsoTgc(current) : config.ssoTgc;
}

function normalizeClientConfig(config: InternalPortalClientConfig): InternalPortalClientConfig {
	const portalBaseUrl = normalizeHttpsUrl(config.portalBaseUrl, "portalBaseUrl");
	const portalPageUrl = normalizeHttpsUrl(config.portalPageUrl, "portalPageUrl");
	if (new URL(portalPageUrl).hostname !== new URL(portalBaseUrl).hostname) {
		throw new PortalCredentialUnavailableError("portalPageUrl must use the portal host");
	}
	const cookieDomain = config.ssoCookieDomain.trim().toLowerCase();
	const cookieHost = cookieDomain.replace(/^\./u, "");
	const portalHost = new URL(portalBaseUrl).hostname.toLowerCase();
	if (!(cookieHost && (portalHost === cookieHost || portalHost.endsWith(`.${cookieHost}`)))) {
		throw new PortalCredentialUnavailableError(
			"ssoCookieDomain must match or parent the portal host",
		);
	}
	return {
		portalBaseUrl,
		portalPageUrl,
		proxyServer: config.proxyServer?.trim() || null,
		ssoCookieDomain: cookieDomain.startsWith(".") ? `.${cookieHost}` : cookieHost,
		ssoTgc: validateSsoTgc(config.ssoTgc),
	};
}

function normalizeHttpsUrl(value: string, field: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new PortalCredentialUnavailableError(`${field} must be an absolute HTTPS URL`);
	}
	if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
		throw new PortalCredentialUnavailableError(`${field} must be a credential-free HTTPS URL`);
	}
	return parsed.toString() === `${parsed.origin}/` ? parsed.origin : parsed.toString();
}

function normalizeBootstrapRedirectUrl(url: URL, config: InternalPortalClientConfig): URL {
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

function assertBootstrapUrlAllowed(url: URL, config: InternalPortalClientConfig): void {
	assertHttpsUrl(url, "internal portal SSO redirect");
	const portalHost = new URL(config.portalBaseUrl).hostname;
	if (url.hostname === portalHost) {
		return;
	}
	const cookieDomain = config.ssoCookieDomain.replace(/^\./u, "").toLowerCase();
	if (url.hostname === cookieDomain || url.hostname.endsWith(`.${cookieDomain}`)) {
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

function toApiResponse(response: Response): InternalPortalApiResponse {
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
		"user-agent": "campus-agent-internal-portal-client/1.0",
	};
}

function buildPortalApiHeaders(config: InternalPortalClientConfig): Record<string, string> {
	return {
		"x-requested-with": "XMLHttpRequest",
		accept: "application/json, text/plain, */*",
		"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
		referer: config.portalPageUrl.replace(/#.*$/u, ""),
	};
}

function isRedirectLimitError(error: unknown): boolean {
	return error instanceof TypeError && error.message.includes(REDIRECT_LIMIT_MESSAGE);
}
