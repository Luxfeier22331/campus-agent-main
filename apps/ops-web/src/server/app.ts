import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { routePath } from "hono/route";
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
import {
	ChatConversationResponseError,
	ChatConversationUnavailableError,
	createChatConversationClient,
} from "./chat-conversation-client.ts";
import {
	ChatFeedbackResponseError,
	ChatFeedbackUnavailableError,
	createChatFeedbackClient,
} from "./chat-feedback-client.ts";
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
import type { DiningSubmissionStore } from "./dining-submission-store-contract.ts";
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
import { createLocalNoticeJobStore } from "./local-notice-jobs.ts";
import {
	createNoticeJobService,
	NoticeJobConflictError,
	NoticeJobNotFoundError,
	type NoticeJobService,
	NoticeJobUnavailableError,
} from "./notice-jobs.ts";
import {
	createNoticePreviewStore,
	type NoticePreviewEnv,
	NoticePreviewError,
	type NoticePreviewStore,
} from "./notice-preview.ts";
import {
	createPgNoticeStore,
	createUnavailableNoticeStore,
	NoticeNotFoundError,
	type NoticeStore,
	NoticeStoreUnavailableError,
} from "./notice-store.ts";
import {
	createOpsAdmissionFromEnv,
	getMissingAccessConfig,
	isLocalOpsEnvironment,
	type OpsAdmission,
	type OpsAdmissionEnv,
} from "./ops-admission.ts";
import { createOpsStatusStore } from "./ops-status/composition/factory.ts";
import {
	createOpsOverviewService,
	type OpsOverviewService,
} from "./ops-status/composition/overview-service.ts";
import {
	type OpsStatusEnv,
	type OpsStatusStore,
	OpsStatusStoreUnavailableError,
} from "./ops-status/contract.ts";
import { createUnavailableOpsStatusStore } from "./ops-status/store/unavailable.ts";
import {
	createProviderConfigAdminClient,
	type ProviderConfigAdminEnv,
	ProviderConfigAdminResponseError,
	ProviderConfigAdminUnavailableError,
} from "./provider-config-client.ts";
import { registerAccountAdminRoutes } from "./routes/account-admin.ts";
import { isAutomationHostRequest, registerAutomationRoutes } from "./routes/automation.ts";
import { CampusGroupsRequestError, registerCampusGroupsRoutes } from "./routes/campus-groups.ts";
import { registerChatConversationRoutes } from "./routes/chat-conversations.ts";
import { registerChatFeedbackRoutes } from "./routes/chat-feedback.ts";
import { registerDiningRoutes } from "./routes/dining.ts";
import { registerDiningSubmissionRoutes } from "./routes/dining-submissions.ts";
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
import { registerNoticePreviewRoutes } from "./routes/notice-preview.ts";
import { registerNoticeRoutes } from "./routes/notices.ts";
import { registerObservabilityRoutes, registerOverviewRoute } from "./routes/observability.ts";
import { registerOcrRoutes } from "./routes/ocr.ts";
import { registerTaskRoutes } from "./routes/tasks.ts";
import { registerTransportRoutes } from "./routes/transport.ts";
import { logOpsError } from "./safe-logging.ts";
import { createTaskService } from "./tasks.ts";
import { createTemporalNoticeJobStore } from "./temporal-notice-jobs.ts";
import { createPgTransportStore } from "./transport-store.ts";
import type { TransportStore } from "./transport-store-contract.ts";
import {
	TransportStoreConflictError,
	TransportStoreNotFoundError,
	TransportStoreUnavailableError,
	TransportStoreValidationError,
} from "./transport-store-errors.ts";

interface OpsHealthEnv {
	TEMPORAL_ADDRESS?: string;
	TEMPORAL_NAMESPACE?: string;
	OPS_WEB_KUBERNETES_NAMESPACE?: string;
	OPS_WEB_AUTOMATION_ORIGIN?: string;
	OPS_WEB_PUBLIC_ORIGIN?: string;
}

type OpsAppEnv = OpsAdmissionEnv &
	AccountAdminEnv &
	CampusGroupsAdminEnv &
	DiningStoreEnv &
	NoticePreviewEnv &
	OpsWebDatabaseEnv &
	OpsHealthEnv &
	OpsStatusEnv &
	EmailAccessAdminEnv &
	ProviderConfigAdminEnv;

interface OpsAppOptions {
	chatConversationClient?: ReturnType<typeof createChatConversationClient>;
	chatFeedbackClient?: ReturnType<typeof createChatFeedbackClient>;
	accountAdminClient?: ReturnType<typeof createAccountAdminClient>;
	admission?: OpsAdmission;
	env?: OpsAppEnv;
	diningMapStore?: DiningMapStore;
	diningMenuStore?: DiningMenuStore;
	diningReviewStore?: DiningReviewStore;
	diningSubmissionStore?: DiningSubmissionStore;
	emailAccessClient?: ReturnType<typeof createEmailAccessAdminClient>;
	internalPortalCredentialService?: InternalPortalCredentialService;
	internalPortalAutomationTokenService?: InternalPortalAutomationTokenService;
	overviewService?: OpsOverviewService;
	noticeJobService?: NoticeJobService;
	noticeStore?: NoticeStore;
	noticePreviewStore?: NoticePreviewStore;
	transportStore?: TransportStore;
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
	const diningSubmissionStore = options.diningSubmissionStore ?? diningStores().submissions;
	const admission = options.admission ?? createOpsAdmissionFromEnv(env);
	const staticRoot = options.staticRoot ?? "dist";
	const store = options.store ?? createDefaultOpsStatusStore(env, databasePool);
	const overviewService =
		options.overviewService ??
		createOpsOverviewService({
			store,
		});
	const noticeJobService = options.noticeJobService ?? createDefaultNoticeJobService(env);
	const noticeStore =
		options.noticeStore ??
		(databasePool
			? createPgNoticeStore(databasePool)
			: createUnavailableNoticeStore(databaseUnavailable));
	const transportStore =
		options.transportStore ??
		(databasePool
			? createPgTransportStore({ pool: databasePool })
			: createUnavailableTransportStore(databaseUnavailable));
	const providerConfigClient = options.providerConfigClient ?? createProviderConfigAdminClient(env);
	const campusGroupsClient =
		options.campusGroupsClient ??
		createCampusGroupsAdminClient({
			...(env.OPS_WEB_APP_API_URL ? { OPS_WEB_APP_API_URL: env.OPS_WEB_APP_API_URL } : {}),
			...(env.OPS_WEB_INTERNAL_TOKEN ? { OPS_WEB_INTERNAL_TOKEN: env.OPS_WEB_INTERNAL_TOKEN } : {}),
		});
	const chatConversationClient =
		options.chatConversationClient ?? createChatConversationClient(env);
	const chatFeedbackClient = options.chatFeedbackClient ?? createChatFeedbackClient(env);
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

	app.onError((error, context) => {
		if (error instanceof NoticePreviewError) {
			return jsonError(error.code, error.message, error.status);
		}
		const respond = (response: Response, failureKind: string) => {
			const requestId = normalizeLogRequestId(
				context.req.header("x-request-id") ?? context.req.param("requestId"),
			);
			logOpsError("ops_web.api_request", error, {
				failure_kind: failureKind,
				http_method: context.req.method,
				http_status_class: `${Math.floor(response.status / 100)}xx`,
				request_id: requestId,
				route_template: routePath(context),
				source: "http",
			});
			return response;
		};
		if (error instanceof ChatConversationUnavailableError) {
			return respond(
				jsonError("OPS_CHAT_CONVERSATION_UNAVAILABLE", "会话后端不可用。", 503),
				"chat_conversation_unavailable",
			);
		}
		if (error instanceof ChatFeedbackUnavailableError) {
			return respond(
				jsonError("OPS_CHAT_FEEDBACK_UNAVAILABLE", "回答反馈后端不可用。", 503),
				"chat_feedback_unavailable",
			);
		}
		if (
			error instanceof ChatFeedbackResponseError ||
			error instanceof ChatConversationResponseError
		) {
			const headers = new Headers(error.response.headers);
			headers.set("cache-control", "no-store");
			return respond(
				new Response(error.response.body, { status: error.response.status, headers }),
				"chat_feedback_response",
			);
		}
		if (error instanceof AccountAdminUnavailableError) {
			return respond(
				jsonError("OPS_ACCOUNT_ADMIN_UNAVAILABLE", "用户管理后端不可用。", 503),
				"account_admin_unavailable",
			);
		}
		if (error instanceof AccountAdminResponseError) {
			return respond(error.response, "account_admin_response");
		}
		if (error instanceof ProviderConfigAdminUnavailableError) {
			return respond(
				jsonError("OPS_PROVIDER_CONFIG_UNAVAILABLE", "在线模型配置服务暂不可用。", 503),
				"provider_config_unavailable",
			);
		}
		if (error instanceof ProviderConfigAdminResponseError) {
			return respond(providerConfigAdminErrorResponse(error), "provider_config_response");
		}
		if (error instanceof EmailAccessAdminUnavailableError) {
			return respond(
				jsonError("OPS_EMAIL_ACCESS_UNAVAILABLE", "账号准入后端不可用。", 503),
				"email_access_unavailable",
			);
		}
		if (error instanceof EmailAccessAdminResponseError) {
			return respond(error.response, "email_access_response");
		}
		if (error instanceof CampusGroupsAdminUnavailableError) {
			return respond(
				jsonError("OPS_CAMPUS_GROUPS_UNAVAILABLE", "同好群内容服务不可用。", 503),
				"campus_groups_unavailable",
			);
		}
		if (error instanceof CampusGroupsAdminResponseError) {
			return respond(error.response, "campus_groups_response");
		}
		if (error instanceof CampusGroupsRequestError) {
			return respond(
				jsonError("OPS_CAMPUS_GROUPS_REQUEST_INVALID", error.message, 400),
				"campus_groups_request_invalid",
			);
		}
		if (error instanceof NoticeJobConflictError) {
			return respond(
				jsonError("OPS_NOTICE_JOB_CONFLICT", error.message, 409, {
					runningJobName: error.runningJobName,
				}),
				"notice_job_conflict",
			);
		}
		if (error instanceof NoticeJobNotFoundError) {
			return respond(
				jsonError("OPS_NOTICE_JOB_NOT_FOUND", error.message, 404),
				"notice_job_not_found",
			);
		}
		if (error instanceof NoticeJobUnavailableError) {
			return respond(
				jsonError("OPS_NOTICE_JOB_UNAVAILABLE", error.message, 503),
				"notice_job_unavailable",
			);
		}
		if (error instanceof NoticeNotFoundError) {
			return jsonError("OPS_NOTICE_NOT_FOUND", error.message, 404);
		}
		if (error instanceof NoticeStoreUnavailableError) {
			return jsonError("OPS_NOTICE_STORE_UNAVAILABLE", error.message, 503);
		}
		if (error instanceof TransportStoreUnavailableError) {
			return respond(
				jsonError("OPS_TRANSPORT_STORE_UNAVAILABLE", "班车管理数据库不可用。", 503),
				"transport_store_unavailable",
			);
		}
		if (error instanceof TransportStoreNotFoundError) {
			return respond(
				jsonError("OPS_TRANSPORT_NOT_FOUND", error.message, 404),
				"transport_not_found",
			);
		}
		if (error instanceof TransportStoreConflictError) {
			return respond(
				jsonError("OPS_TRANSPORT_CONFLICT", error.message, 409, error.details),
				"transport_conflict",
			);
		}
		if (error instanceof TransportStoreValidationError) {
			return respond(jsonError("OPS_TRANSPORT_INVALID", error.message, 400), "transport_invalid");
		}
		if (error instanceof InternalPortalCredentialStoreUnavailableError) {
			return respond(
				jsonError("OPS_INTERNAL_PORTAL_STORE_UNAVAILABLE", "内部门户凭据数据库暂不可用。", 503),
				"internal_portal_store_unavailable",
			);
		}
		if (error instanceof InternalPortalAutomationTokenStoreUnavailableError) {
			return respond(
				jsonError(
					"OPS_AUTOMATION_TOKEN_STORE_UNAVAILABLE",
					"自动化访问 token 数据库暂不可用。",
					503,
				),
				"automation_token_store_unavailable",
			);
		}
		if (error instanceof InternalPortalAutomationTokenNotFoundError) {
			return respond(
				jsonError("OPS_AUTOMATION_TOKEN_NOT_FOUND", error.message, 404),
				"automation_token_not_found",
			);
		}
		if (error instanceof InternalPortalCredentialNotFoundError) {
			return respond(
				jsonError("OPS_INTERNAL_PORTAL_NOT_FOUND", error.message, 404),
				"internal_portal_not_found",
			);
		}
		if (error instanceof InternalPortalCredentialConflictError) {
			return respond(
				jsonError("OPS_INTERNAL_PORTAL_CONFLICT", error.message, 409),
				"internal_portal_conflict",
			);
		}
		if (error instanceof InternalPortalCredentialNameConflictError) {
			return respond(
				jsonError("OPS_INTERNAL_PORTAL_NAME_CONFLICT", error.message, 409),
				"internal_portal_name_conflict",
			);
		}
		if (error instanceof InternalPortalCandidateInputError) {
			return respond(
				jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", error.message, 400),
				"internal_portal_input_invalid",
			);
		}
		if (error instanceof InternalPortalCandidateRejectedError) {
			return respond(
				jsonError("OPS_INTERNAL_PORTAL_CREDENTIAL_REJECTED", error.message, 422),
				"internal_portal_credential_rejected",
			);
		}
		if (error instanceof InternalPortalCandidateCheckFailedError) {
			return respond(
				jsonError("OPS_INTERNAL_PORTAL_CHECK_FAILED", error.message, 503),
				"internal_portal_check_failed",
			);
		}
		if (error instanceof InternalPortalCredentialResolutionUnavailableError) {
			return respond(
				jsonError("OPS_INTERNAL_PORTAL_CREDENTIAL_UNAVAILABLE", error.message, 503),
				"internal_portal_credential_unavailable",
			);
		}
		if (error instanceof DiningStoreUnavailableError) {
			return respond(
				jsonError("OPS_DINING_STORE_UNAVAILABLE", "食堂管理数据库不可用。", 503),
				"dining_store_unavailable",
			);
		}
		if (error instanceof DiningStoreNotFoundError) {
			return respond(jsonError("OPS_DINING_NOT_FOUND", error.message, 404), "dining_not_found");
		}
		if (error instanceof DiningStoreConflictError) {
			return respond(
				jsonError("OPS_DINING_CONFLICT", error.message, 409, error.details),
				"dining_conflict",
			);
		}
		if (error instanceof DiningStoreValidationError) {
			return respond(jsonError("OPS_DINING_INVALID", error.message, 400), "dining_invalid");
		}
		const storeUnavailableReasonCode = classifyStoreUnavailableError(error);
		if (storeUnavailableReasonCode) {
			return respond(
				jsonError("OPS_STATUS_STORE_UNAVAILABLE", "请求状态数据库不可用。", 503, {
					reasonCode: storeUnavailableReasonCode,
				}),
				storeUnavailableReasonCode.toLowerCase(),
			);
		}
		return respond(
			jsonError("OPS_API_INTERNAL_ERROR", "运维接口请求失败。", 500),
			"unhandled_error",
		);
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
	registerOcrRoutes({
		admission,
		app,
		providerConfigClient,
		publicOrigin,
		pool: databasePool,
		env: env as NodeJS.ProcessEnv,
	});
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
	registerChatConversationRoutes({ admission, app, client: chatConversationClient });
	registerChatFeedbackRoutes({ admission, app, client: chatFeedbackClient });
	registerAccountAdminRoutes({ admission, app, client: accountAdminClient, publicOrigin });
	registerEmailAccessRoutes({ admission, app, client: emailAccessClient, publicOrigin });
	registerObservabilityRoutes({ admission, app, store });
	registerCampusGroupsRoutes({ admission, app, client: campusGroupsClient, publicOrigin });
	registerTaskRoutes({
		admission,
		app,
		service: createTaskService({
			local: isLocalOpsEnvironment(env),
			namespace: env.OPS_WEB_KUBERNETES_NAMESPACE?.trim() || "default",
			env,
			...(databasePool ? { pool: databasePool } : {}),
		}),
	});

	registerNoticeRoutes({ admission, app, jobService: noticeJobService, store: noticeStore });
	registerNoticePreviewRoutes({
		admission,
		app,
		store: noticeStore,
		source: options.noticePreviewStore ?? createNoticePreviewStore(env),
	});
	registerDiningSubmissionRoutes({ app, admission, store: diningSubmissionStore, publicOrigin });
	registerDiningRoutes({
		admission,
		app,
		diningMapStore,
		diningMenuStore,
		diningReviewStore,
		publicOrigin,
	});
	registerTransportRoutes({ admission, app, publicOrigin, store: transportStore });

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

export function createDefaultNoticeJobService(
	env: Pick<
		OpsAppEnv,
		| "DEPLOYMENT_ENVIRONMENT"
		| "OPS_WEB_KUBERNETES_NAMESPACE"
		| "TEMPORAL_ADDRESS"
		| "TEMPORAL_NAMESPACE"
	>,
): NoticeJobService {
	return createNoticeJobService(
		isLocalOpsEnvironment(env) ? createLocalNoticeJobStore() : createTemporalNoticeJobStore(env),
	);
}

function createUnavailableTransportStore(cause: unknown): TransportStore {
	const fail = () =>
		Promise.reject(new TransportStoreUnavailableError("班车管理数据库不可用。", { cause }));
	return {
		listSchedulePeriodNotices: fail,
		replaceSchedulePeriodNotices: fail,
		listNoticeSchedulePeriods: fail,
		createRoute: fail,
		createSchedulePeriod: fail,
		deleteRoute: fail,
		deleteSchedulePeriod: fail,
		listRoutes: fail,
		listSchedulePeriods: fail,
		updateRoute: fail,
		updateSchedulePeriod: fail,
	};
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

function classifyReadinessError(error: unknown) {
	if (error instanceof OpsStatusStoreUnavailableError) {
		return error.reasonCode;
	}
	return "OPS_STATUS_STORE_UNAVAILABLE" as const;
}

function classifyStoreUnavailableError(error: unknown) {
	return error instanceof OpsStatusStoreUnavailableError ? error.reasonCode : null;
}

function normalizeLogRequestId(value: string | undefined): string | null {
	const normalized = value?.trim();
	return normalized && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(normalized) ? normalized : null;
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
