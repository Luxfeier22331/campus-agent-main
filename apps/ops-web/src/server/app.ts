import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { Pool } from "pg";
import {
	type AccountAdminEnv,
	AccountAdminResponseError,
	AccountAdminUnavailableError,
	createAccountAdminClient,
} from "./account-admin-client.ts";
import {
	type CampusGroupsAdminEnv,
	CampusGroupsAdminResponseError,
	CampusGroupsAdminUnavailableError,
	createCampusGroupsAdminClient,
} from "./campus-groups-client.ts";
import type { OpsWebDatabaseEnv } from "./database.ts";
import type {
	DiningMapStore,
	DiningMenuStore,
	DiningReviewStore,
	DiningStoreEnv,
	DiningStores,
} from "./dining-store-contract.ts";
import {
	DiningStoreConflictError,
	DiningStoreNotFoundError,
	DiningStoreUnavailableError,
	DiningStoreValidationError,
} from "./dining-store-errors.ts";
import { createDiningStores, createUnavailableDiningStores } from "./dining-stores.ts";
import {
	createEmailAccessAdminClient,
	type EmailAccessAdminEnv,
	EmailAccessAdminResponseError,
	EmailAccessAdminUnavailableError,
} from "./email-access-client.ts";
import {
	createInternalPortalAutomationTokenService,
	type InternalPortalAutomationTokenService,
} from "./internal-portal-automation-token-service.ts";
import {
	createPgInternalPortalAutomationTokenStore,
	createUnavailableInternalPortalAutomationTokenStore,
	InternalPortalAutomationTokenNotFoundError,
	InternalPortalAutomationTokenStoreUnavailableError,
} from "./internal-portal-automation-token-store.ts";
import {
	createInternalPortalCredentialService,
	createUnavailableInternalPortalCredentialService,
	InternalPortalCandidateCheckFailedError,
	InternalPortalCandidateInputError,
	InternalPortalCandidateRejectedError,
	InternalPortalCredentialConflictError,
	InternalPortalCredentialNameConflictError,
	InternalPortalCredentialNotFoundError,
	InternalPortalCredentialResolutionUnavailableError,
	type InternalPortalCredentialService,
	InternalPortalCredentialStoreUnavailableError,
} from "./internal-portal-credential-service.ts";
import { createPgInternalPortalCredentialStore } from "./internal-portal-credential-store.ts";
import {
	createKubernetesNoticePipelineJobStore,
	createNoticePipelineJobService,
	NoticePipelineConflictError,
	NoticePipelineJobNotFoundError,
	type NoticePipelineJobService,
	NoticePipelineUnavailableError,
} from "./notice-pipeline-jobs.ts";
import {
	createOpsAdmissionFromEnv,
	getMissingAccessConfig,
	isLocalOpsEnvironment,
	type OpsAdmission,
	type OpsAdmissionEnv,
} from "./ops-admission.ts";
import { createOpsOverviewService, type OpsOverviewService } from "./ops-overview-service.ts";
import { createOpsStatusStore } from "./ops-status-factory.ts";
import {
	type OpsStatusEnv,
	type OpsStatusStore,
	OpsStatusStoreUnavailableError,
} from "./ops-status-types.ts";
import { createUnavailableOpsStatusStore } from "./ops-status-unavailable.ts";
import {
	createProviderConfigAdminClient,
	type ProviderConfigAdminEnv,
	ProviderConfigAdminResponseError,
	ProviderConfigAdminUnavailableError,
} from "./provider-config-client.ts";
import { registerAccountAdminRoutes } from "./routes/account-admin.ts";
import { isAutomationHostRequest, registerAutomationRoutes } from "./routes/automation.ts";
import { CampusGroupsRequestError, registerCampusGroupsRoutes } from "./routes/campus-groups.ts";
import { registerDiningRoutes } from "./routes/dining.ts";
import { registerEmailAccessRoutes } from "./routes/email-access.ts";
import { jsonError } from "./routes/http.ts";
import {
	registerInternalPortalInternalRoutes,
	registerInternalPortalRoutes,
} from "./routes/internal-portal.ts";
import {
	providerConfigAdminErrorResponse,
	registerModelSettingsRoutes,
} from "./routes/model-settings.ts";
import { registerNoticePipelineRoutes } from "./routes/notice-pipeline.ts";
import { registerObservabilityRoutes, registerOverviewRoute } from "./routes/observability.ts";
import { logOpsError } from "./safe-logging.ts";
import {
	createSentryClientFromEnv,
	type SentryClient,
	type SentryEnv,
	SentryUnavailableError,
} from "./sentry-client.ts";

interface OpsHealthEnv {
	OPS_WEB_KUBERNETES_NAMESPACE?: string;
	OPS_WEB_AUTOMATION_ORIGIN?: string;
	OPS_WEB_PUBLIC_ORIGIN?: string;
}

type OpsAppEnv = OpsAdmissionEnv &
	AccountAdminEnv &
	CampusGroupsAdminEnv &
	DiningStoreEnv &
	OpsWebDatabaseEnv &
	OpsHealthEnv &
	OpsStatusEnv &
	EmailAccessAdminEnv &
	ProviderConfigAdminEnv &
	SentryEnv;

interface OpsAppOptions {
	accountAdminClient?: ReturnType<typeof createAccountAdminClient>;
	admission?: OpsAdmission;
	env?: OpsAppEnv;
	diningMapStore?: DiningMapStore;
	diningMenuStore?: DiningMenuStore;
	diningReviewStore?: DiningReviewStore;
	emailAccessClient?: ReturnType<typeof createEmailAccessAdminClient>;
	internalPortalCredentialService?: InternalPortalCredentialService;
	internalPortalAutomationTokenService?: InternalPortalAutomationTokenService;
	overviewService?: OpsOverviewService;
	noticePipelineJobService?: NoticePipelineJobService;
	sentry?: SentryClient;
	staticRoot?: string;
	store?: OpsStatusStore;
	providerConfigClient?: ReturnType<typeof createProviderConfigAdminClient>;
	campusGroupsClient?: ReturnType<typeof createCampusGroupsAdminClient>;
	databasePool?: Pool;
}

export function createOpsApp(options: OpsAppOptions = {}) {
	const app = new Hono();
	const env = options.env ?? process.env;
	const publicOrigin = resolveOpsPublicOrigin(env);
	const automationOrigin = resolveOpsAutomationOrigin(env);
	const automationHost = resolveOriginHost(automationOrigin);
	const databasePool = options.databasePool;
	const databaseUnavailable = createDatabaseUnavailableError(env);
	let defaultDiningStores: DiningStores | undefined;
	const diningStores = () =>
		(defaultDiningStores ??= databasePool
			? createDiningStores({ env, pool: databasePool })
			: createUnavailableDiningStores(databaseUnavailable));
	const diningMapStore = options.diningMapStore ?? diningStores().map;
	const diningMenuStore = options.diningMenuStore ?? diningStores().menu;
	const diningReviewStore = options.diningReviewStore ?? diningStores().reviews;
	const admission = options.admission ?? createOpsAdmissionFromEnv(env);
	const staticRoot = options.staticRoot ?? "dist";
	const store = options.store ?? createDefaultOpsStatusStore(env, databasePool);
	const sentry = options.sentry ?? createDefaultSentryClient(env);
	const overviewService =
		options.overviewService ??
		createOpsOverviewService({
			store,
		});
	const noticePipelineJobService =
		options.noticePipelineJobService ??
		createNoticePipelineJobService(
			createKubernetesNoticePipelineJobStore(env.OPS_WEB_KUBERNETES_NAMESPACE?.trim() || "default"),
		);
	const providerConfigClient = options.providerConfigClient ?? createProviderConfigAdminClient(env);
	const campusGroupsClient =
		options.campusGroupsClient ??
		createCampusGroupsAdminClient({
			...(env.OPS_WEB_APP_API_URL ? { OPS_WEB_APP_API_URL: env.OPS_WEB_APP_API_URL } : {}),
			...(env.OPS_WEB_INTERNAL_TOKEN ? { OPS_WEB_INTERNAL_TOKEN: env.OPS_WEB_INTERNAL_TOKEN } : {}),
		});
	const accountAdminClient = options.accountAdminClient ?? createAccountAdminClient(env);
	const emailAccessClient = options.emailAccessClient ?? createEmailAccessAdminClient(env);
	const internalPortalCredentialService =
		options.internalPortalCredentialService ??
		createDefaultInternalPortalCredentialService(databasePool, databaseUnavailable);
	const internalPortalAutomationTokenService =
		options.internalPortalAutomationTokenService ??
		createDefaultInternalPortalAutomationTokenService(databasePool, databaseUnavailable);

	app.use(
		"*",
		secureHeaders({
			contentSecurityPolicy: {
				baseUri: ["'self'"],
				connectSrc: ["'self'", "blob:", "https://cdn.tldraw.com"],
				defaultSrc: ["'self'"],
				fontSrc: ["'self'"],
				formAction: ["'self'"],
				frameAncestors: ["'none'"],
				imgSrc: ["'self'", "data:"],
				objectSrc: ["'none'"],
				scriptSrc: ["'self'"],
				styleSrc: ["'self'", "'unsafe-inline'"],
			},
			permissionsPolicy: {
				camera: [],
				geolocation: [],
				microphone: [],
				payment: [],
				usb: [],
			},
			referrerPolicy: "no-referrer",
			xFrameOptions: "DENY",
		}),
	);
	app.use("*", async (context, next) => {
		if (
			isAutomationHostRequest(context.req.raw, automationHost) &&
			!isAutomationHostPath(context.req.path)
		) {
			return jsonError("OPS_API_ROUTE_NOT_FOUND", "未找到该运维接口。", 404);
		}
		return next();
	});

	app.onError((error) => {
		logOpsError("ops_web.api_request", error, { source: "http" });
		if (error instanceof SentryUnavailableError) {
			return jsonError("OPS_SENTRY_UNAVAILABLE", "Sentry Issue 数据不可用。", 503);
		}
		if (error instanceof AccountAdminUnavailableError) {
			return jsonError("OPS_ACCOUNT_ADMIN_UNAVAILABLE", "用户管理后端不可用。", 503);
		}
		if (error instanceof AccountAdminResponseError) {
			return error.response;
		}
		if (error instanceof ProviderConfigAdminUnavailableError) {
			return jsonError("OPS_PROVIDER_CONFIG_UNAVAILABLE", "在线模型配置服务暂不可用。", 503);
		}
		if (error instanceof ProviderConfigAdminResponseError) {
			return providerConfigAdminErrorResponse(error);
		}
		if (error instanceof EmailAccessAdminUnavailableError) {
			return jsonError("OPS_EMAIL_ACCESS_UNAVAILABLE", "账号准入后端不可用。", 503);
		}
		if (error instanceof EmailAccessAdminResponseError) {
			return error.response;
		}
		if (error instanceof CampusGroupsAdminUnavailableError) {
			return jsonError("OPS_CAMPUS_GROUPS_UNAVAILABLE", "同好群内容服务不可用。", 503);
		}
		if (error instanceof CampusGroupsAdminResponseError) {
			return error.response;
		}
		if (error instanceof CampusGroupsRequestError) {
			return jsonError("OPS_CAMPUS_GROUPS_REQUEST_INVALID", error.message, 400);
		}
		if (error instanceof NoticePipelineConflictError) {
			return jsonError("OPS_NOTICE_JOB_CONFLICT", error.message, 409, {
				runningJobName: error.runningJobName,
			});
		}
		if (error instanceof NoticePipelineJobNotFoundError) {
			return jsonError("OPS_NOTICE_JOB_NOT_FOUND", error.message, 404);
		}
		if (error instanceof NoticePipelineUnavailableError) {
			return jsonError("OPS_NOTICE_JOB_UNAVAILABLE", error.message, 503);
		}
		if (error instanceof InternalPortalCredentialStoreUnavailableError) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_STORE_UNAVAILABLE",
				"内部门户凭据数据库暂不可用。",
				503,
			);
		}
		if (error instanceof InternalPortalAutomationTokenStoreUnavailableError) {
			return jsonError(
				"OPS_AUTOMATION_TOKEN_STORE_UNAVAILABLE",
				"自动化访问 token 数据库暂不可用。",
				503,
			);
		}
		if (error instanceof InternalPortalAutomationTokenNotFoundError) {
			return jsonError("OPS_AUTOMATION_TOKEN_NOT_FOUND", error.message, 404);
		}
		if (error instanceof InternalPortalCredentialNotFoundError) {
			return jsonError("OPS_INTERNAL_PORTAL_NOT_FOUND", error.message, 404);
		}
		if (error instanceof InternalPortalCredentialConflictError) {
			return jsonError("OPS_INTERNAL_PORTAL_CONFLICT", error.message, 409);
		}
		if (error instanceof InternalPortalCredentialNameConflictError) {
			return jsonError("OPS_INTERNAL_PORTAL_NAME_CONFLICT", error.message, 409);
		}
		if (error instanceof InternalPortalCandidateInputError) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", error.message, 400);
		}
		if (error instanceof InternalPortalCandidateRejectedError) {
			return jsonError("OPS_INTERNAL_PORTAL_CREDENTIAL_REJECTED", error.message, 422);
		}
		if (error instanceof InternalPortalCandidateCheckFailedError) {
			return jsonError("OPS_INTERNAL_PORTAL_CHECK_FAILED", error.message, 503);
		}
		if (error instanceof InternalPortalCredentialResolutionUnavailableError) {
			return jsonError("OPS_INTERNAL_PORTAL_CREDENTIAL_UNAVAILABLE", error.message, 503);
		}
		if (error instanceof DiningStoreUnavailableError) {
			return jsonError("OPS_DINING_STORE_UNAVAILABLE", "食堂管理数据库不可用。", 503);
		}
		if (error instanceof DiningStoreNotFoundError) {
			return jsonError("OPS_DINING_NOT_FOUND", error.message, 404);
		}
		if (error instanceof DiningStoreConflictError) {
			return jsonError("OPS_DINING_CONFLICT", error.message, 409, error.details);
		}
		if (error instanceof DiningStoreValidationError) {
			return jsonError("OPS_DINING_INVALID", error.message, 400);
		}
		const storeUnavailableReasonCode = classifyStoreUnavailableError(error);
		if (storeUnavailableReasonCode) {
			return jsonError("OPS_STATUS_STORE_UNAVAILABLE", "请求状态数据库不可用。", 503, {
				reasonCode: storeUnavailableReasonCode,
			});
		}
		return jsonError("OPS_API_INTERNAL_ERROR", "运维接口请求失败。", 500);
	});

	app.get("/healthz", (context) => context.json({ ok: true, service: "ops-web" }));

	app.get("/readyz", async (context) => {
		try {
			const missingAccessConfig = isLocalOpsEnvironment(env) ? [] : getMissingAccessConfig(env);
			if (!publicOrigin) {
				missingAccessConfig.push("OPS_WEB_PUBLIC_ORIGIN");
			}
			if (missingAccessConfig.length > 0) {
				return context.json(
					{
						error: {
							code: "OPS_WEB_NOT_READY",
							message: "Ops Web 核心配置未完成。",
							missing: missingAccessConfig,
						},
						ok: false,
						service: "ops-web",
					},
					503,
				);
			}
			await store.verifyReadiness();
			return context.json({ ok: true, service: "ops-web" });
		} catch (error) {
			const reasonCode = classifyReadinessError(error);
			logOpsError("ops_web.readiness", error, {
				failure_kind: reasonCode,
				source: "readiness",
			});
			return context.json(
				{
					error: {
						code: "OPS_WEB_NOT_READY",
						message: "请求状态数据库尚未就绪。",
						reasonCode,
					},
					ok: false,
					service: "ops-web",
				},
				503,
			);
		}
	});

	app.use("/api/ops/*", async (context, next) => {
		context.header("cache-control", "no-store");
		await next();
	});
	app.use("/api/automation/*", async (context, next) => {
		context.header("cache-control", "no-store");
		await next();
	});

	registerOverviewRoute({ admission, app, overviewService });
	registerModelSettingsRoutes({ admission, app, providerConfigClient, publicOrigin });
	registerInternalPortalRoutes({
		admission,
		app,
		credentialService: internalPortalCredentialService,
		publicOrigin,
	});
	registerInternalPortalInternalRoutes({
		app,
		credentialService: internalPortalCredentialService,
		...(env.OPS_WEB_INTERNAL_TOKEN === undefined
			? {}
			: { internalToken: env.OPS_WEB_INTERNAL_TOKEN }),
	});
	registerAutomationRoutes({
		admission,
		app,
		automationHost,
		automationOrigin,
		credentialService: internalPortalCredentialService,
		publicOrigin,
		tokenService: internalPortalAutomationTokenService,
	});
	registerAccountAdminRoutes({ admission, app, client: accountAdminClient, publicOrigin });
	registerEmailAccessRoutes({ admission, app, client: emailAccessClient, publicOrigin });
	registerObservabilityRoutes({ admission, app, sentry, store });
	registerCampusGroupsRoutes({ admission, app, client: campusGroupsClient, publicOrigin });
	registerNoticePipelineRoutes({ admission, app, service: noticePipelineJobService });
	registerDiningRoutes({
		admission,
		app,
		diningMapStore,
		diningMenuStore,
		diningReviewStore,
		publicOrigin,
	});

	app.all("/api/*", () => jsonError("OPS_API_ROUTE_NOT_FOUND", "未找到该运维接口。"));
	app.use("/*", serveStatic({ root: staticRoot }));
	app.get("*", async (context, next) => {
		if (isStaticAssetPath(context.req.path)) {
			return context.notFound();
		}
		return next();
	});
	app.get("*", serveStatic({ path: "index.html", root: staticRoot }));
	return app;
}

function createDefaultInternalPortalCredentialService(
	pool: Pool | undefined,
	databaseUnavailable: Error,
): InternalPortalCredentialService {
	try {
		return pool
			? createInternalPortalCredentialService({
					store: createPgInternalPortalCredentialStore(pool),
				})
			: createUnavailableInternalPortalCredentialService(databaseUnavailable);
	} catch (error) {
		return createUnavailableInternalPortalCredentialService(error);
	}
}

function createDefaultInternalPortalAutomationTokenService(
	pool: Pool | undefined,
	databaseUnavailable: Error,
): InternalPortalAutomationTokenService {
	return createInternalPortalAutomationTokenService({
		store: pool
			? createPgInternalPortalAutomationTokenStore(pool)
			: createUnavailableInternalPortalAutomationTokenStore(databaseUnavailable),
	});
}

function createDefaultOpsStatusStore(
	env: OpsStatusEnv & OpsWebDatabaseEnv,
	pool: Pool | undefined,
): OpsStatusStore {
	if (pool) {
		return createOpsStatusStore({ env, pool });
	}
	const reasonCode = env.OPS_WEB_DATABASE_URL?.trim()
		? "OPS_STATUS_STORE_UNAVAILABLE"
		: "OPS_WEB_DATABASE_URL_MISSING";
	return createUnavailableOpsStatusStore(reasonCode, createDatabaseUnavailableError(env).message);
}

function createDatabaseUnavailableError(env: OpsWebDatabaseEnv): Error {
	return new Error(
		env.OPS_WEB_DATABASE_URL?.trim()
			? "Ops Web database pool is unavailable."
			: "OPS_WEB_DATABASE_URL is required.",
	);
}

function createDefaultSentryClient(env: SentryEnv): SentryClient {
	try {
		return createSentryClientFromEnv(env);
	} catch (error) {
		return {
			queryRequestIssues: async () => {
				throw error instanceof SentryUnavailableError
					? error
					: new SentryUnavailableError("Sentry client is unavailable.", { cause: error });
			},
		};
	}
}

function classifyReadinessError(error: unknown) {
	if (error instanceof OpsStatusStoreUnavailableError) {
		return error.reasonCode;
	}
	return "OPS_STATUS_STORE_UNAVAILABLE" as const;
}

function classifyStoreUnavailableError(error: unknown) {
	return error instanceof OpsStatusStoreUnavailableError ? error.reasonCode : null;
}

function isStaticAssetPath(path: string) {
	return /\.[A-Za-z0-9]+$/.test(path.split("/").at(-1) ?? "");
}

function resolveOpsPublicOrigin(env: OpsHealthEnv): string | null {
	return resolveHttpOrigin(env.OPS_WEB_PUBLIC_ORIGIN);
}

function resolveOpsAutomationOrigin(env: OpsHealthEnv): string | null {
	return resolveHttpOrigin(env.OPS_WEB_AUTOMATION_ORIGIN);
}

function resolveOriginHost(origin: string | null): string | null {
	return origin ? new URL(origin).host : null;
}

function resolveHttpOrigin(value: string | undefined): string | null {
	const configured = value?.trim();
	if (!configured) {
		return null;
	}
	try {
		const parsed = new URL(configured);
		const isLoopbackHttp =
			parsed.protocol === "http:" &&
			(parsed.hostname === "127.0.0.1" ||
				parsed.hostname === "localhost" ||
				parsed.hostname === "[::1]");
		return (parsed.protocol === "https:" || isLoopbackHttp) && parsed.origin === configured
			? parsed.origin
			: null;
	} catch {
		return null;
	}
}

function isAutomationHostPath(path: string): boolean {
	return path === "/healthz" || path === "/readyz" || path.startsWith("/api/automation/");
}
