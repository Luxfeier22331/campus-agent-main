import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, type BrowserContext, chromium, request } from "playwright";

import { PortalCredentialExpiredError, PortalCredentialUnavailableError } from "./auth-errors.js";
import {
	ensureRuntimeDirs,
	type InternalPortalConfig,
	resolveInternalPortalConfig,
} from "./config.js";
import type { ApiRequestContextLike, ApiResponseLike, DisposableApiContextLike } from "./types.js";

type PortalStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
type PortalRequestContext = ApiRequestContextLike &
	DisposableApiContextLike & {
		storageState?: () => Promise<PortalStorageState>;
	};

const SSO_TGC_COOKIE_NAME = "SSO_TGC";

export interface PortalAuthenticationRefreshResult {
	noticeProbeSucceeded: true;
	portalSessionEstablished: true;
	refreshedAt: string;
	serviceTicketIssued: true;
}

interface PortalBootstrapResult {
	result: PortalAuthenticationRefreshResult;
	storageState: PortalStorageState;
}

export interface CreatePortalApiContextDependencies {
	bootstrapStorageState?: (input: {
		config: InternalPortalConfig;
		ssoTgc: string;
	}) => Promise<PortalBootstrapResult>;
	createRequestContext?: (input: {
		baseURL: string;
		extraHTTPHeaders: Record<string, string>;
		proxy?: { server: string };
		storageState: PortalStorageState;
	}) => Promise<PortalRequestContext>;
}

export async function createPortalApiContext(
	config: InternalPortalConfig = resolveInternalPortalConfig(process.env),
	dependencies: CreatePortalApiContextDependencies = {},
): Promise<ApiRequestContextLike & DisposableApiContextLike> {
	const session = new RecoveringPortalSession(config, dependencies);
	await session.initialize();
	return session;
}

export async function refreshPortalAuthentication(
	config: InternalPortalConfig = resolveInternalPortalConfig(process.env),
	dependencies: CreatePortalApiContextDependencies = {},
): Promise<PortalAuthenticationRefreshResult> {
	return (await refreshPortalSessionState(config, dependencies)).result;
}

class RecoveringPortalSession implements ApiRequestContextLike, DisposableApiContextLike {
	private activeContext: PortalRequestContext | null = null;
	private readonly config: InternalPortalConfig;
	private readonly dependencies: CreatePortalApiContextDependencies;
	private generation = 0;
	private readonly contexts: PortalRequestContext[] = [];
	private refreshPromise: Promise<void> | null = null;

	constructor(config: InternalPortalConfig, dependencies: CreatePortalApiContextDependencies) {
		this.config = config;
		this.dependencies = dependencies;
	}

	async initialize(): Promise<void> {
		ensureRuntimeDirs(this.config);
		const ssoTgc = readSsoTgcFile(this.config.authSsoTgcFile);
		const storedState = readStoredAuthStorageState(this.config.authStorageStatePath);
		if (storedState && storageStateHasTgc(storedState, ssoTgc)) {
			await this.activateContext(storedState);
			return;
		}
		await this.refreshSession();
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
		if (this.activeContext?.storageState) {
			writeStoredAuthStorageState(
				this.config.authStorageStatePath,
				await this.activeContext.storageState(),
			);
		}
		await Promise.allSettled(this.contexts.map(async (context) => await context.dispose()));
		this.activeContext = null;
	}

	private async performRequest(
		operation: (context: PortalRequestContext) => Promise<ApiResponseLike>,
	): Promise<ApiResponseLike> {
		const generation = this.generation;
		const response = await operation(this.requireContext());
		if (isAuthHttpStatus(response.status())) {
			return await this.retryAfterRefresh(generation, operation);
		}
		return wrapRecoveringResponse(response, async () =>
			this.retryAfterRefresh(generation, operation),
		);
	}

	private async retryAfterRefresh(
		failedGeneration: number,
		operation: (context: PortalRequestContext) => Promise<ApiResponseLike>,
	): Promise<ApiResponseLike> {
		await this.refreshIfGeneration(failedGeneration);
		const response = await operation(this.requireContext());
		if (isAuthHttpStatus(response.status())) {
			throw new PortalCredentialExpiredError();
		}
		return wrapRecoveringResponse(response, async () => {
			throw new PortalCredentialExpiredError();
		});
	}

	private async refreshIfGeneration(failedGeneration: number): Promise<void> {
		if (this.generation !== failedGeneration) {
			return;
		}
		await this.refreshSession();
	}

	private async refreshSession(): Promise<void> {
		if (!this.refreshPromise) {
			this.refreshPromise = this.performRefresh().finally(() => {
				this.refreshPromise = null;
			});
		}
		await this.refreshPromise;
	}

	private async performRefresh(): Promise<void> {
		const refreshed = await refreshPortalSessionState(this.config, this.dependencies);
		await this.activateContext(refreshed.storageState);
	}

	private async activateContext(storageState: PortalStorageState): Promise<void> {
		const context = await (this.dependencies.createRequestContext ?? defaultCreateRequestContext)({
			baseURL: this.config.portalBaseUrl,
			extraHTTPHeaders: buildPortalApiHeaders(this.config),
			...buildProxyOption(this.config),
			storageState,
		});
		this.contexts.push(context);
		this.activeContext = context;
		this.generation += 1;
	}

	private requireContext(): PortalRequestContext {
		if (!this.activeContext) {
			throw new Error("internal portal API context is not initialized");
		}
		return this.activeContext;
	}
}

async function refreshPortalSessionState(
	config: InternalPortalConfig,
	dependencies: CreatePortalApiContextDependencies,
): Promise<PortalBootstrapResult> {
	ensureRuntimeDirs(config);
	const ssoTgc = readSsoTgcFile(config.authSsoTgcFile);
	if (!config.authSsoCookieDomain) {
		throw new PortalCredentialUnavailableError(
			"INTERNAL_PORTAL_SSO_COOKIE_DOMAIN is required for internal portal authentication",
		);
	}
	const refreshed = await (dependencies.bootstrapStorageState ?? defaultBootstrapStorageState)({
		config,
		ssoTgc,
	});
	if (!storageStateHasTgc(refreshed.storageState, ssoTgc)) {
		throw new PortalCredentialExpiredError("portal login did not retain the supplied SSO_TGC");
	}
	writeStoredAuthStorageState(config.authStorageStatePath, refreshed.storageState);
	return refreshed;
}

async function defaultBootstrapStorageState(input: {
	config: InternalPortalConfig;
	ssoTgc: string;
}): Promise<PortalBootstrapResult> {
	const browser = await chromium.launch({
		headless: true,
		proxy: input.config.portalProxyServer ? { server: input.config.portalProxyServer } : undefined,
	});
	try {
		const context = await browser.newContext({
			baseURL: input.config.portalBaseUrl,
			storageState: buildTgcStorageState(input.config, input.ssoTgc),
		});
		try {
			const page = await context.newPage();
			let serviceTicketIssued = false;
			page.on("request", (pageRequest) => {
				try {
					const requestUrl = new URL(pageRequest.url());
					const ticket = requestUrl.searchParams.get("ticket");
					if (
						requestUrl.hostname === new URL(input.config.portalBaseUrl).hostname &&
						ticket?.startsWith("ST-")
					) {
						serviceTicketIssued = true;
					}
				} catch {
					// Ignore non-URL browser requests.
				}
			});
			await page.goto(input.config.portalBaseUrl, {
				timeout: 30_000,
				waitUntil: "domcontentloaded",
			});
			const finalUrl = new URL(page.url());
			if (finalUrl.hostname !== new URL(input.config.portalBaseUrl).hostname) {
				throw new PortalCredentialExpiredError();
			}
			if (!serviceTicketIssued) {
				throw new PortalCredentialExpiredError("portal SSO did not issue a service ticket");
			}
			const apiContext = await defaultCreateRequestContext({
				baseURL: input.config.portalBaseUrl,
				extraHTTPHeaders: buildPortalApiHeaders(input.config),
				...buildProxyOption(input.config),
				storageState: await context.storageState(),
			});
			try {
				await assertNoticeApiSession(apiContext, input.config);
				return {
					result: {
						noticeProbeSucceeded: true,
						portalSessionEstablished: true,
						refreshedAt: new Date().toISOString(),
						serviceTicketIssued: true,
					},
					storageState: await apiContext.storageState(),
				};
			} finally {
				await apiContext.dispose();
			}
		} finally {
			await context.close();
		}
	} finally {
		await browser.close();
	}
}

async function assertNoticeApiSession(
	apiContext: APIRequestContext,
	config: InternalPortalConfig,
): Promise<void> {
	const response = await apiContext.post("/comsys-portal-notice-web/getNoticeByPage", {
		form: {
			currentPage: "1",
			pageSize: "1",
			type: config.authCheckNoticeType,
			searchValue: "",
			state: "",
			is_add: "0",
			totalCounts: "0",
			total: "-1",
			select_all: "false",
			select_notice: "",
			searchDepartment: "",
			start_date: "",
			end_date: "",
			new_total: "",
		},
	});
	if (!response.ok()) {
		throw new PortalCredentialExpiredError();
	}
	const payload = await response.text();
	if (isSessionInvalidPayload(payload)) {
		throw new PortalCredentialExpiredError();
	}
	try {
		const parsed = JSON.parse(payload) as { state?: boolean };
		if (parsed.state !== true) {
			throw new PortalCredentialExpiredError();
		}
	} catch (error) {
		if (error instanceof PortalCredentialExpiredError) {
			throw error;
		}
		throw new PortalCredentialExpiredError();
	}
}

function defaultCreateRequestContext(input: {
	baseURL: string;
	extraHTTPHeaders: Record<string, string>;
	proxy?: { server: string };
	storageState: PortalStorageState;
}): Promise<APIRequestContext> {
	return request.newContext(input);
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

function validateSsoTgc(value: string): string {
	if (!value) {
		throw new PortalCredentialUnavailableError("internal portal SSO credential file is empty");
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
				"internal portal SSO credential file must contain only the raw SSO_TGC value",
			);
		}
	}
	return value;
}

function readStoredAuthStorageState(storageStatePath: string): PortalStorageState | null {
	if (!fs.existsSync(storageStatePath)) {
		return null;
	}
	try {
		const parsed = JSON.parse(fs.readFileSync(storageStatePath, "utf-8")) as PortalStorageState;
		return Array.isArray(parsed.cookies) && Array.isArray(parsed.origins) ? parsed : null;
	} catch {
		return null;
	}
}

function writeStoredAuthStorageState(
	storageStatePath: string,
	storageState: PortalStorageState,
): void {
	const directory = path.dirname(storageStatePath);
	fs.mkdirSync(directory, { mode: 0o700, recursive: true });
	fs.chmodSync(directory, 0o700);
	const temporaryPath = `${storageStatePath}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(temporaryPath, JSON.stringify(storageState, null, 2), {
		encoding: "utf-8",
		mode: 0o600,
	});
	fs.renameSync(temporaryPath, storageStatePath);
	fs.chmodSync(storageStatePath, 0o600);
}

function buildTgcStorageState(config: InternalPortalConfig, ssoTgc: string): PortalStorageState {
	if (!config.authSsoCookieDomain) {
		throw new PortalCredentialUnavailableError(
			"INTERNAL_PORTAL_SSO_COOKIE_DOMAIN is required for internal portal authentication",
		);
	}
	return {
		cookies: [
			{
				domain: config.authSsoCookieDomain,
				expires: -1,
				httpOnly: true,
				name: SSO_TGC_COOKIE_NAME,
				path: "/",
				sameSite: "Lax",
				secure: true,
				value: ssoTgc,
			},
		],
		origins: [],
	};
}

function storageStateHasTgc(storageState: PortalStorageState, ssoTgc: string): boolean {
	return storageState.cookies.some(
		(cookie) => cookie.name === SSO_TGC_COOKIE_NAME && cookie.value === ssoTgc,
	);
}

function wrapRecoveringResponse(
	response: ApiResponseLike,
	recover: () => Promise<ApiResponseLike>,
): ApiResponseLike {
	return {
		body: response.body
			? async () => {
					const readBody = response.body;
					if (!readBody) {
						throw new Error("portal response body is unavailable");
					}
					const payload = await readBody.call(response);
					if (!isSessionInvalidPayload(payload.toString("utf-8"))) {
						return payload;
					}
					const retried = await recover();
					let retriedPayload: Buffer;
					if (retried.body) {
						retriedPayload = await retried.body();
					} else if (retried.text) {
						retriedPayload = Buffer.from(await retried.text(), "utf-8");
					} else {
						throw new Error("retried portal response body is unavailable");
					}
					if (isSessionInvalidPayload(retriedPayload.toString("utf-8"))) {
						throw new PortalCredentialExpiredError();
					}
					return retriedPayload;
				}
			: undefined,
		headers: response.headers
			? () => {
					const readHeaders = response.headers;
					return readHeaders ? readHeaders.call(response) : {};
				}
			: undefined,
		json: async () => {
			const payload = await response.json();
			if (!isSessionInvalidJson(payload)) {
				return payload;
			}
			const retried = await recover();
			const retriedPayload = await retried.json();
			if (isSessionInvalidJson(retriedPayload)) {
				throw new PortalCredentialExpiredError();
			}
			return retriedPayload;
		},
		ok: () => response.ok(),
		status: () => response.status(),
		statusText: () => response.statusText(),
		text: response.text
			? async () => {
					const readText = response.text;
					if (!readText) {
						throw new Error("portal response text is unavailable");
					}
					const payload = await readText.call(response);
					if (!isSessionInvalidPayload(payload)) {
						return payload;
					}
					const retried = await recover();
					const retriedPayload = retried.text
						? await retried.text()
						: JSON.stringify(await retried.json());
					if (isSessionInvalidPayload(retriedPayload)) {
						throw new PortalCredentialExpiredError();
					}
					return retriedPayload;
				}
			: undefined,
	};
}

function isAuthHttpStatus(status: number): boolean {
	return status === 401 || status === 403;
}

function isSessionInvalidPayload(payload: string): boolean {
	const normalized = payload.trim();
	if (normalized === "error_comsys_session_invalid") {
		return true;
	}
	try {
		return isSessionInvalidJson(JSON.parse(normalized));
	} catch {
		return false;
	}
}

function isSessionInvalidJson(payload: unknown): boolean {
	if (!payload || typeof payload !== "object") {
		return false;
	}
	const candidate = payload as { state?: unknown; msg?: unknown };
	if (candidate.state !== false && candidate.state !== 0) {
		return false;
	}
	const message = typeof candidate.msg === "string" ? candidate.msg.toLowerCase() : "";
	return message.includes("session") || message.includes("登录") || message.includes("认证");
}

function buildPortalApiHeaders(config: InternalPortalConfig): Record<string, string> {
	return {
		"x-requested-with": "XMLHttpRequest",
		accept: "application/json, text/plain, */*",
		"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
		referer: config.portalPageUrl.replace(/#.*$/, ""),
	};
}

function buildProxyOption(config: InternalPortalConfig): { proxy?: { server: string } } {
	return config.portalProxyServer ? { proxy: { server: config.portalProxyServer } } : {};
}
