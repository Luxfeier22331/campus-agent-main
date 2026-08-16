import { MIMEType } from "node:util";
import {
	DiningMenuItemCreateSchema,
	DiningMenuItemMoveSchema,
	DiningMenuItemUpdateSchema,
	DiningMenuOrderSchema,
	DiningOpsReviewCreateSchema,
	DiningOpsReviewUpdateSchema,
	DiningOpsReviewVisibilitySchema,
	DiningReportResolutionSchema,
} from "@campus-agent/dining/domain";
import { serveStatic } from "@hono/node-server/serve-static";
import {
	AccountAdminEmptyCommandSchema,
	AccountAdminEventQuerySchema,
	AccountAdminIdentifierSchema,
	AccountAdminReasonSchema,
	AccountAdminUserActionSchema,
	AccountAdminUserQuerySchema,
} from "campus-contracts/account-admin";
import {
	type CampusGroupsCatalog,
	CampusGroupsCatalogSchema,
} from "campus-contracts/campus-groups";
import { CreateEmailAccessGrantSchema } from "campus-contracts/email-access";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { DiningDraftUpdateSchema, DiningRevisionSchema } from "../shared/dining-contract.ts";
import {
	EmbeddingModelSettingUpdateSchema,
	InternalPortalAutomationCredentialUpdateSchema,
	InternalPortalAutomationTokenCreateSchema,
	InternalPortalAutomationTokenListSchema,
	type InternalPortalAutomationTokenMetadata,
	InternalPortalAutomationTokenMetadataResponseSchema,
	InternalPortalAutomationTokenResponseSchema,
	InternalPortalCredentialCreateSchema,
	InternalPortalCredentialListSchema,
	InternalPortalCredentialResponseSchema,
	InternalPortalCredentialRevealSchema,
	InternalPortalCredentialSchema,
	InternalPortalCredentialUpdateSchema,
	LLMModelSettingUpdateSchema,
	ModelDiscoveryRequestSchema,
	ModelSettingKindSchema,
	OpsObservabilityResponseSchema,
	OpsOverviewResponseSchema,
	OpsOverviewWindowSchema,
	OpsRequestDetailResponseSchema,
	OpsRequestListResponseSchema,
	OpsRequestListViewSchema,
	OpsRequestWindowSchema,
	OpsSentryIssuesResponseSchema,
} from "../shared/ops-contract.ts";
import {
	type AccountAdminEnv,
	AccountAdminResponseError,
	AccountAdminUnavailableError,
	createAccountAdminClient,
} from "./account-admin-client.ts";
import {
	type AxiomClient,
	type AxiomEnv,
	AxiomUnavailableError,
	createAxiomClientFromEnv,
} from "./axiom-client.ts";
import {
	type CampusGroupsAdminEnv,
	CampusGroupsAdminResponseError,
	CampusGroupsAdminUnavailableError,
	createCampusGroupsAdminClient,
} from "./campus-groups-client.ts";
import {
	createDiningContentStoreFromEnv,
	createUnavailableDiningContentStore,
	type DiningContentStore,
} from "./dining-content-store.ts";
import {
	createDiningStoreFromEnv,
	createUnavailableDiningStore,
	type DiningStore,
	DiningStoreConflictError,
	type DiningStoreEnv,
	DiningStoreNotFoundError,
	DiningStoreUnavailableError,
	DiningStoreValidationError,
} from "./dining-store.ts";
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
	createInternalPortalAutomationTokenStoreFromEnv,
	createUnavailableInternalPortalAutomationTokenStore,
	InternalPortalAutomationTokenNotFoundError,
	InternalPortalAutomationTokenStoreUnavailableError,
} from "./internal-portal-automation-token-store.ts";
import { InternalPortalCandidateInputError } from "./internal-portal-candidate-input.ts";
import {
	createInternalPortalCredentialService,
	InternalPortalCandidateCheckFailedError,
	InternalPortalCandidateRejectedError,
	type InternalPortalCredentialService,
} from "./internal-portal-credential-service.ts";
import {
	createInternalPortalCredentialStoreFromEnv,
	createUnavailableInternalPortalCredentialStore,
	InternalPortalCredentialConflictError,
	InternalPortalCredentialNameConflictError,
	InternalPortalCredentialNotFoundError,
	InternalPortalCredentialStoreUnavailableError,
} from "./internal-portal-credential-store.ts";
import {
	createOpsAdmissionFromEnv,
	getMissingAccessConfig,
	isLocalOpsEnvironment,
	type OpsAdmission,
	type OpsAdmissionEnv,
	type OpsOperatorContext,
} from "./ops-admission.ts";
import { createOpsOverviewService, type OpsOverviewService } from "./ops-overview-service.ts";
import { decodeRequestCursor } from "./ops-status-mappers.ts";
import {
	createOpsStatusStoreFromEnv,
	createUnavailableOpsStatusStore,
	type OpsStatusEnv,
	type OpsStatusStore,
	OpsStatusStoreUnavailableError,
} from "./ops-status-store.ts";
import { PostgresTlsConfigurationError } from "./postgres-tls.ts";
import {
	createProviderConfigAdminClient,
	type ProviderConfigAdminEnv,
	ProviderConfigAdminResponseError,
	ProviderConfigAdminUnavailableError,
} from "./provider-config-client.ts";
import { logOpsError } from "./safe-logging.ts";
import {
	createSentryClientFromEnv,
	type SentryClient,
	type SentryEnv,
	SentryUnavailableError,
} from "./sentry-client.ts";

interface OpsHealthEnv {
	OPS_WEB_AUTOMATION_ORIGIN?: string;
	OPS_WEB_PUBLIC_ORIGIN?: string;
}

type OpsAppEnv = OpsAdmissionEnv &
	AccountAdminEnv &
	AxiomEnv &
	CampusGroupsAdminEnv &
	DiningStoreEnv &
	OpsHealthEnv &
	OpsStatusEnv &
	EmailAccessAdminEnv &
	ProviderConfigAdminEnv &
	SentryEnv;

interface OpsAppOptions {
	accountAdminClient?: ReturnType<typeof createAccountAdminClient>;
	admission?: OpsAdmission;
	axiom?: AxiomClient;
	env?: OpsAppEnv;
	diningStore?: DiningStore;
	diningContentStore?: DiningContentStore;
	emailAccessClient?: ReturnType<typeof createEmailAccessAdminClient>;
	internalPortalCredentialService?: InternalPortalCredentialService;
	internalPortalAutomationTokenService?: InternalPortalAutomationTokenService;
	overviewService?: OpsOverviewService;
	sentry?: SentryClient;
	staticRoot?: string;
	store?: OpsStatusStore;
	providerConfigClient?: ReturnType<typeof createProviderConfigAdminClient>;
	campusGroupsClient?: ReturnType<typeof createCampusGroupsAdminClient>;
}

const RequestListQuerySchema = z
	.object({
		conversationId: z.string().trim().min(1).max(128).optional(),
		cursor: z.string().trim().min(1).max(512).optional(),
		q: z.string().trim().min(1).max(256).optional(),
		requestId: z.string().trim().min(1).max(128).optional(),
		runId: z.string().trim().min(1).max(128).optional(),
		status: z
			.enum(["COMPLETED", "FAILED", "CANCELLED", "RUNNING", "PENDING", "ACTION_REQUIRED"])
			.optional(),
		traceId: z.string().trim().min(1).max(128).optional(),
		view: OpsRequestListViewSchema.default("recent"),
		window: OpsRequestWindowSchema.default("1h"),
		workflowId: z.string().trim().min(1).max(128).optional(),
	})
	.strict();
const OverviewQuerySchema = z.object({ window: OpsOverviewWindowSchema.default("1h") }).strict();
const ObservabilityQuerySchema = z.object({ kind: z.literal("logs") }).strict();
const OpsPathIdSchema = z
	.string()
	.min(1)
	.max(200)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const DiningReviewListQuerySchema = z
	.object({
		cursor: z.string().trim().min(1).max(512).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
		menu_item_id: OpsPathIdSchema.optional(),
		q: z.string().trim().min(1).max(200).optional(),
		visibility: z.enum(["visible", "hidden", "deleted"]).optional(),
		window_id: OpsPathIdSchema.optional(),
	})
	.strict();
const EmailAccessQuerySchema = z
	.object({
		cursor: z.string().trim().min(1).max(512).optional(),
		email: z.string().trim().min(1).max(320).optional(),
		kind: z.enum(["invitation", "test"]).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
		state: z.enum(["pending", "active", "revoked", "expired"]).optional(),
	})
	.strict();

class CampusGroupsRequestError extends Error {}
const DiningReportListQuerySchema = z
	.object({
		cursor: z.string().trim().min(1).max(512).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
		status: z.enum(["pending", "resolved"]).default("pending"),
	})
	.strict();

export function createOpsApp(options: OpsAppOptions = {}) {
	const app = new Hono();
	const env = options.env ?? process.env;
	const publicOrigin = resolveOpsPublicOrigin(env);
	const automationOrigin = resolveOpsAutomationOrigin(env);
	const automationHost = resolveOriginHost(automationOrigin);
	const diningStore = options.diningStore ?? createDefaultDiningStore(env);
	const diningContentStore = options.diningContentStore ?? createDefaultDiningContentStore(env);
	const admission = options.admission ?? createOpsAdmissionFromEnv(env);
	const staticRoot = options.staticRoot ?? "dist";
	const store = options.store ?? createDefaultOpsStatusStore(env);
	const axiom = options.axiom ?? createDefaultAxiomClient(env);
	const sentry = options.sentry ?? createDefaultSentryClient(env);
	const overviewService =
		options.overviewService ??
		createOpsOverviewService({
			store,
		});
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
		options.internalPortalCredentialService ?? createDefaultInternalPortalCredentialService(env);
	const internalPortalAutomationTokenService =
		options.internalPortalAutomationTokenService ??
		createDefaultInternalPortalAutomationTokenService(env);

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
		if (error instanceof AxiomUnavailableError) {
			return jsonError("OPS_OBSERVABILITY_UNAVAILABLE", "Axiom 数据不可用。", 503);
		}
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

	app.get("/api/ops/overview", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const parsed = OverviewQuerySchema.safeParse(context.req.query());
		if (!parsed.success) {
			return jsonError("OPS_INVALID_QUERY", "运行概览查询参数无效。", 400);
		}
		const response = OpsOverviewResponseSchema.parse(
			await overviewService.getOverview(parsed.data.window, { signal: context.req.raw.signal }),
		);
		context.header("cache-control", "private, max-age=15, stale-if-error=300");
		return context.json(response);
	});

	app.get("/api/ops/model-settings/execution", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		return context.json(await providerConfigClient.getStatus());
	});

	app.post("/api/ops/model-settings/execution/llm/models", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (!requestHasConfiguredOrigin(context.req.raw, publicOrigin)) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_CSRF_REJECTED",
				"在线模型配置写请求未通过同源校验。",
				403,
			);
		}
		if (!isJsonContentType(context.req.header("content-type"))) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_CONTENT_TYPE_REQUIRED",
				"Content-Type 必须是 application/json。",
				400,
			);
		}
		const body = ModelDiscoveryRequestSchema.safeParse(
			await readBoundedJson(context.req.raw, 20 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_INVALID_JSON", "模型列表请求内容无效。", 400);
		}
		return context.json(await providerConfigClient.discoverModels(body.data, operator.operatorId));
	});

	app.put("/api/ops/model-settings/execution/:kind", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (!requestHasConfiguredOrigin(context.req.raw, publicOrigin)) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_CSRF_REJECTED",
				"在线模型配置写请求未通过同源校验。",
				403,
			);
		}
		if (!isJsonContentType(context.req.header("content-type"))) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_CONTENT_TYPE_REQUIRED",
				"Content-Type 必须是 application/json。",
				400,
			);
		}
		const kind = ModelSettingKindSchema.safeParse(context.req.param("kind"));
		const rawBody = await context.req.json().catch(() => null);
		const body =
			kind.success && kind.data === "embedding"
				? EmbeddingModelSettingUpdateSchema.safeParse(rawBody)
				: LLMModelSettingUpdateSchema.safeParse(rawBody);
		if (!(kind.success && body.success)) {
			return jsonError("OPS_INVALID_JSON", "请求体必须是有效 JSON。", 400);
		}
		const etag = context.req.header("if-match")?.trim();
		if (!etag || etag.length > 200) {
			return jsonError("OPS_MODEL_SETTINGS_PRECONDITION_REQUIRED", "请刷新模型配置后再保存。", 400);
		}
		const result = await providerConfigClient.put(kind.data, body.data, operator.operatorId, etag);
		return context.json(result);
	});

	app.post("/api/ops/model-settings/execution/:kind/validate", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (!requestHasConfiguredOrigin(context.req.raw, publicOrigin)) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_CSRF_REJECTED",
				"在线模型配置写请求未通过同源校验。",
				403,
			);
		}
		const kind = ModelSettingKindSchema.safeParse(context.req.param("kind"));
		if (!kind.success) {
			return jsonError("OPS_API_ROUTE_NOT_FOUND", "未找到该运维接口。", 404);
		}
		return context.json(await providerConfigClient.validate(kind.data, operator.operatorId));
	});

	app.get("/api/ops/internal-portal/credentials", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		return context.json(
			InternalPortalCredentialListSchema.parse({
				credentials: await internalPortalCredentialService.list(),
			}),
		);
	});

	app.post("/api/ops/internal-portal/credentials", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, true);
		if (writeError) {
			return writeError;
		}
		const body = InternalPortalCredentialCreateSchema.safeParse(
			await readBoundedJson(context.req.raw, 20 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据信息无效。", 400);
		}
		const credential = InternalPortalCredentialSchema.parse(
			await internalPortalCredentialService.create(body.data, context.req.raw.signal),
		);
		context.header("etag", formatCredentialEtag(credential.version));
		return context.json({ credential }, 201);
	});

	app.put("/api/ops/internal-portal/credentials/:credentialId", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, true);
		if (writeError) {
			return writeError;
		}
		const credentialId = z.string().uuid().safeParse(context.req.param("credentialId"));
		const expectedVersion = parseCredentialEtag(context.req.header("if-match"));
		const body = InternalPortalCredentialUpdateSchema.safeParse(
			await readBoundedJson(context.req.raw, 20 * 1024),
		);
		if (!(credentialId.success && body.success)) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据修改内容无效。", 400);
		}
		if (!expectedVersion) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_PRECONDITION_REQUIRED",
				"请刷新内部门户凭据后再修改。",
				428,
			);
		}
		const credential = InternalPortalCredentialSchema.parse(
			"name" in body.data
				? await internalPortalCredentialService.rename(
						credentialId.data,
						body.data.name,
						expectedVersion,
					)
				: await internalPortalCredentialService.rotate(
						credentialId.data,
						body.data.ssoTgc,
						expectedVersion,
						context.req.raw.signal,
					),
		);
		context.header("etag", formatCredentialEtag(credential.version));
		return context.json({ credential });
	});

	app.delete("/api/ops/internal-portal/credentials/:credentialId", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, false);
		if (writeError) {
			return writeError;
		}
		const credentialId = z.string().uuid().safeParse(context.req.param("credentialId"));
		const expectedVersion = parseCredentialEtag(context.req.header("if-match"));
		if (!credentialId.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据标识无效。", 400);
		}
		if (!expectedVersion) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_PRECONDITION_REQUIRED",
				"请刷新内部门户凭据后再删除。",
				428,
			);
		}
		await internalPortalCredentialService.delete(credentialId.data, expectedVersion);
		return new Response(null, { status: 204 });
	});

	app.post("/api/ops/internal-portal/credentials/:credentialId/validate", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, false);
		if (writeError) {
			return writeError;
		}
		const credentialId = z.string().uuid().safeParse(context.req.param("credentialId"));
		if (!credentialId.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据标识无效。", 400);
		}
		const credential = InternalPortalCredentialSchema.parse(
			await internalPortalCredentialService.validate(credentialId.data, context.req.raw.signal),
		);
		context.header("etag", formatCredentialEtag(credential.version));
		return context.json({ credential });
	});

	app.post("/api/ops/internal-portal/credentials/:credentialId/reveal", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, false);
		if (writeError) {
			return writeError;
		}
		const credentialId = z.string().uuid().safeParse(context.req.param("credentialId"));
		if (!credentialId.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据标识无效。", 400);
		}
		const revealed = InternalPortalCredentialRevealSchema.parse(
			await internalPortalCredentialService.reveal(credentialId.data),
		);
		context.header("etag", formatCredentialEtag(revealed.version));
		return context.json(revealed);
	});

	app.get("/api/ops/internal-portal/automation-tokens", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const configurationError = getAutomationConfigurationError(automationOrigin);
		if (configurationError) {
			return configurationError;
		}
		return context.json(
			InternalPortalAutomationTokenListSchema.parse({
				endpoint: automationOrigin,
				tokens: await internalPortalAutomationTokenService.list(),
			}),
		);
	});

	app.post("/api/ops/internal-portal/automation-tokens", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const configurationError = getAutomationConfigurationError(automationOrigin);
		if (configurationError) {
			return configurationError;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, true);
		if (writeError) {
			return writeError;
		}
		const body = InternalPortalAutomationTokenCreateSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_AUTOMATION_TOKEN_INPUT_INVALID", "自动化访问 token 名称无效。", 400);
		}
		const token = await internalPortalAutomationTokenService.create(body.data.name);
		return context.json(InternalPortalAutomationTokenResponseSchema.parse({ token }), 201);
	});

	app.post("/api/ops/internal-portal/automation-tokens/:tokenId/reveal", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const configurationError = getAutomationConfigurationError(automationOrigin);
		if (configurationError) {
			return configurationError;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, false);
		if (writeError) {
			return writeError;
		}
		const tokenId = z.string().uuid().safeParse(context.req.param("tokenId"));
		if (!tokenId.success) {
			return jsonError("OPS_AUTOMATION_TOKEN_INPUT_INVALID", "自动化访问 token 标识无效。", 400);
		}
		const token = await internalPortalAutomationTokenService.reveal(tokenId.data);
		return context.json(InternalPortalAutomationTokenResponseSchema.parse({ token }));
	});

	app.post("/api/ops/internal-portal/automation-tokens/:tokenId/revoke", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const configurationError = getAutomationConfigurationError(automationOrigin);
		if (configurationError) {
			return configurationError;
		}
		const writeError = validateInternalPortalWriteRequest(context.req.raw, publicOrigin, false);
		if (writeError) {
			return writeError;
		}
		const tokenId = z.string().uuid().safeParse(context.req.param("tokenId"));
		if (!tokenId.success) {
			return jsonError("OPS_AUTOMATION_TOKEN_INPUT_INVALID", "自动化访问 token 标识无效。", 400);
		}
		const token = await internalPortalAutomationTokenService.revoke(tokenId.data);
		return context.json(InternalPortalAutomationTokenMetadataResponseSchema.parse({ token }));
	});

	registerAutomationCredentialRoutes({
		automationHost,
		credentialService: internalPortalCredentialService,
		app,
		tokenService: internalPortalAutomationTokenService,
	});

	app.get("/api/ops/users", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = AccountAdminUserQuerySchema.safeParse(context.req.query());
		if (!query.success) {
			return jsonError("OPS_INVALID_QUERY", "用户查询参数无效。", 400);
		}
		return context.json(await accountAdminClient.listUsers(toSearchParams(query.data)));
	});

	app.get("/api/ops/users/:userId", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const userId = AccountAdminIdentifierSchema.safeParse(context.req.param("userId"));
		if (!userId.success) {
			return jsonError("OPS_INVALID_USER_ID", "用户 ID 无效。", 400);
		}
		return context.json(await accountAdminClient.getUser(userId.data));
	});

	app.post("/api/ops/users/:userId/sessions/:sessionId/revoke", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const write = validateAccountAdminWriteRequest(context.req.raw, publicOrigin);
		if (write instanceof Response) {
			return write;
		}
		const userId = AccountAdminIdentifierSchema.safeParse(context.req.param("userId"));
		const sessionId = AccountAdminIdentifierSchema.safeParse(context.req.param("sessionId"));
		if (!(userId.success && sessionId.success)) {
			return jsonError("OPS_ACCOUNT_ADMIN_ROUTE_NOT_FOUND", "未找到该会话操作。", 404);
		}
		const body = AccountAdminEmptyCommandSchema.safeParse(
			await context.req.json().catch(() => null),
		);
		if (!body.success) {
			return jsonError("OPS_ACCOUNT_ADMIN_INPUT_INVALID", "会话操作内容无效。", 400);
		}
		return context.json(
			await accountAdminClient.revokeSession(
				userId.data,
				sessionId.data,
				operator.operatorId,
				write.idempotencyKey,
			),
		);
	});

	app.post("/api/ops/users/:userId/:action", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const write = validateAccountAdminWriteRequest(context.req.raw, publicOrigin);
		if (write instanceof Response) {
			return write;
		}
		const userId = AccountAdminIdentifierSchema.safeParse(context.req.param("userId"));
		const action = AccountAdminUserActionSchema.safeParse(context.req.param("action"));
		if (!(userId.success && action.success)) {
			return jsonError("OPS_ACCOUNT_ADMIN_ROUTE_NOT_FOUND", "未找到该用户操作。", 404);
		}
		const rawBody = await context.req.json().catch(() => null);
		const body =
			action.data === "password-reset-email" || action.data === "verification-email"
				? AccountAdminEmptyCommandSchema.safeParse(rawBody)
				: AccountAdminReasonSchema.safeParse(rawBody);
		if (!body.success) {
			return jsonError("OPS_ACCOUNT_ADMIN_INPUT_INVALID", "用户操作内容无效。", 400);
		}
		return context.json(
			await accountAdminClient.commandUser(
				userId.data,
				action.data,
				body.data,
				operator.operatorId,
				write.idempotencyKey,
			),
		);
	});

	app.get("/api/ops/account-events", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = AccountAdminEventQuerySchema.safeParse(context.req.query());
		if (!query.success) {
			return jsonError("OPS_INVALID_QUERY", "账号操作记录查询参数无效。", 400);
		}
		return context.json(await accountAdminClient.listEvents(toSearchParams(query.data)));
	});

	app.get("/api/ops/email-access-grants", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = EmailAccessQuerySchema.safeParse(context.req.query());
		if (!query.success) {
			return jsonError("OPS_INVALID_QUERY", "账号准入查询参数无效。", 400);
		}
		return context.json(await emailAccessClient.list(toSearchParams(query.data)));
	});

	app.post("/api/ops/email-access-grants", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const write = validateEmailAccessWriteRequest(context.req.raw, publicOrigin);
		if (write instanceof Response) {
			return write;
		}
		const body = CreateEmailAccessGrantSchema.safeParse(await context.req.json().catch(() => null));
		if (!body.success) {
			return jsonError("OPS_EMAIL_ACCESS_INPUT_INVALID", "账号准入信息无效。", 400);
		}
		return context.json(
			await emailAccessClient.command("", body.data, operator.operatorId, write.idempotencyKey),
			201,
		);
	});

	app.post("/api/ops/email-access-grants/:grantId/:action", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const write = validateEmailAccessWriteRequest(context.req.raw, publicOrigin);
		if (write instanceof Response) {
			return write;
		}
		const grantId = z.string().uuid().safeParse(context.req.param("grantId"));
		const action = z.enum(["resend", "revoke"]).safeParse(context.req.param("action"));
		if (!(grantId.success && action.success)) {
			return jsonError("OPS_API_ROUTE_NOT_FOUND", "未找到该账号准入操作。", 404);
		}
		const body = AccountAdminEmptyCommandSchema.safeParse(
			await context.req.json().catch(() => null),
		);
		if (!body.success) {
			return jsonError("OPS_EMAIL_ACCESS_INPUT_INVALID", "账号准入操作内容无效。", 400);
		}
		return context.json(
			await emailAccessClient.command(
				`/${grantId.data}/${action.data}`,
				body.data,
				operator.operatorId,
				write.idempotencyKey,
			),
		);
	});

	app.get("/api/ops/requests", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const parsed = RequestListQuerySchema.safeParse(context.req.query());
		if (!parsed.success) {
			return jsonError("OPS_INVALID_QUERY", "运行记录查询参数无效。", 400);
		}
		if (parsed.data.cursor && !decodeRequestCursor(parsed.data.cursor, parsed.data.view)) {
			return jsonError("OPS_INVALID_QUERY", "运行记录翻页参数无效。", 400);
		}
		const query = parsed.data;
		return context.json(
			OpsRequestListResponseSchema.parse(
				await store.listRequests({
					...(query.conversationId ? { conversationId: query.conversationId } : {}),
					...(query.cursor ? { cursor: query.cursor } : {}),
					...(query.q ? { q: query.q } : {}),
					...(query.requestId ? { requestId: query.requestId } : {}),
					...(query.runId ? { runId: query.runId } : {}),
					...(query.status ? { status: query.status } : {}),
					...(query.traceId ? { traceId: query.traceId } : {}),
					view: query.view,
					window: query.window,
					...(query.workflowId ? { workflowId: query.workflowId } : {}),
				}),
			),
		);
	});

	app.get("/api/ops/requests/:requestId", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const requestId = context.req.param("requestId");
		if (!OpsPathIdSchema.safeParse(requestId).success) {
			return jsonError("OPS_INVALID_REQUEST_ID", "请求 ID 无效。", 400);
		}
		const detail = await store.getRequestDetail(requestId);
		if (!detail) {
			return jsonError("OPS_REQUEST_NOT_FOUND", "未找到该请求。");
		}
		return context.json(OpsRequestDetailResponseSchema.parse(detail));
	});

	app.get("/api/ops/requests/:requestId/observability", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const requestId = context.req.param("requestId");
		const parsedQuery = ObservabilityQuerySchema.safeParse(context.req.query());
		if (!(OpsPathIdSchema.safeParse(requestId).success && parsedQuery.success)) {
			return jsonError("OPS_INVALID_QUERY", "日志查询参数无效。", 400);
		}
		const detail = await store.getRequestDetail(requestId);
		if (!detail) {
			return jsonError("OPS_REQUEST_NOT_FOUND", "未找到该请求。");
		}
		const response = OpsObservabilityResponseSchema.parse(
			await axiom.queryRequest({
				completedAt: detail.request.completedAt,
				kind: parsedQuery.data.kind,
				requestId: detail.request.requestId,
				signal: context.req.raw.signal,
				startedAt: detail.request.startedAt,
			}),
		);
		return context.json(response);
	});

	app.get("/api/ops/requests/:requestId/sentry-issues", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const requestId = context.req.param("requestId");
		if (
			!OpsPathIdSchema.safeParse(requestId).success ||
			Object.keys(context.req.query()).length > 0
		) {
			return jsonError("OPS_INVALID_QUERY", "Sentry Issue 查询参数无效。", 400);
		}
		const detail = await store.getRequestDetail(requestId);
		if (!detail) {
			return jsonError("OPS_REQUEST_NOT_FOUND", "未找到该请求。");
		}
		return context.json(
			OpsSentryIssuesResponseSchema.parse(
				await sentry.queryRequestIssues({
					completedAt: detail.request.completedAt,
					requestId: detail.request.requestId,
					signal: context.req.raw.signal,
					startedAt: detail.request.startedAt,
				}),
			),
		);
	});

	app.get("/api/ops/groups/catalog", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		return operator instanceof Response
			? operator
			: context.json(await campusGroupsClient.getCatalog());
	});

	app.put("/api/ops/groups/catalog", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (!requestHasConfiguredOrigin(context.req.raw, publicOrigin)) {
			return jsonError("OPS_GROUPS_ORIGIN_INVALID", "同好群修改请求来源无效。", 403);
		}
		return context.json(
			await campusGroupsClient.replaceCatalog(
				parseCampusGroupsCatalog(await readBoundedJson(context.req.raw, 8 * 1024 * 1024)),
			),
		);
	});

	registerDiningRoutes({ admission, app, diningContentStore, diningStore, publicOrigin });

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

function registerAutomationCredentialRoutes(input: {
	app: Hono;
	automationHost: string | null;
	credentialService: InternalPortalCredentialService;
	tokenService: InternalPortalAutomationTokenService;
}): void {
	input.app.post("/api/automation/internal-portal/credentials", async (context) => {
		const token = await admitAutomationRequest(
			context.req.raw,
			input.automationHost,
			input.tokenService,
		);
		if (token instanceof Response) {
			return token;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_AUTOMATION_QUERY_INVALID", "自动化凭据创建不接受参数。", 400);
		}
		if (!isJsonContentType(context.req.header("content-type"))) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_CONTENT_TYPE_REQUIRED",
				"Content-Type 必须是 application/json。",
				400,
			);
		}
		const body = InternalPortalCredentialCreateSchema.safeParse(
			await readBoundedJson(context.req.raw, 20 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据信息无效。", 400);
		}
		const credential = InternalPortalCredentialSchema.parse(
			await input.credentialService.create(body.data, context.req.raw.signal),
		);
		context.header("etag", formatCredentialEtag(credential.version));
		return context.json({ credential }, 201);
	});

	input.app.get("/api/automation/internal-portal/credentials", async (context) => {
		const token = await admitAutomationRequest(
			context.req.raw,
			input.automationHost,
			input.tokenService,
		);
		if (token instanceof Response) {
			return token;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_AUTOMATION_QUERY_INVALID", "自动化凭据查询不接受参数。", 400);
		}
		return context.json(
			InternalPortalCredentialListSchema.parse({
				credentials: await input.credentialService.list(),
			}),
		);
	});

	input.app.get("/api/automation/internal-portal/credentials/:credentialId", async (context) => {
		const token = await admitAutomationRequest(
			context.req.raw,
			input.automationHost,
			input.tokenService,
		);
		if (token instanceof Response) {
			return token;
		}
		const credentialId = z.string().uuid().safeParse(context.req.param("credentialId"));
		if (!credentialId.success || Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据标识无效。", 400);
		}
		const credential = (await input.credentialService.list()).find(
			(entry) => entry.credentialId === credentialId.data,
		);
		if (!credential) {
			throw new InternalPortalCredentialNotFoundError();
		}
		context.header("etag", formatCredentialEtag(credential.version));
		return context.json(InternalPortalCredentialResponseSchema.parse({ credential }));
	});

	input.app.put("/api/automation/internal-portal/credentials/:credentialId", async (context) => {
		const token = await admitAutomationRequest(
			context.req.raw,
			input.automationHost,
			input.tokenService,
		);
		if (token instanceof Response) {
			return token;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_AUTOMATION_QUERY_INVALID", "自动化凭据修改不接受参数。", 400);
		}
		const credentialId = z.string().uuid().safeParse(context.req.param("credentialId"));
		const expectedVersion = parseCredentialEtag(context.req.header("if-match"));
		if (!credentialId.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据标识无效。", 400);
		}
		if (!expectedVersion) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_PRECONDITION_REQUIRED",
				"请刷新内部门户凭据后再修改。",
				428,
			);
		}
		if (!isJsonContentType(context.req.header("content-type"))) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_CONTENT_TYPE_REQUIRED",
				"Content-Type 必须是 application/json。",
				400,
			);
		}
		const body = InternalPortalAutomationCredentialUpdateSchema.safeParse(
			await readBoundedJson(context.req.raw, 20 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据修改内容无效。", 400);
		}
		const credential = await input.credentialService.rotate(
			credentialId.data,
			body.data.ssoTgc,
			expectedVersion,
			context.req.raw.signal,
		);
		context.header("etag", formatCredentialEtag(credential.version));
		return context.json({ credential: InternalPortalCredentialSchema.parse(credential) });
	});

	input.app.delete("/api/automation/internal-portal/credentials/:credentialId", async (context) => {
		const token = await admitAutomationRequest(
			context.req.raw,
			input.automationHost,
			input.tokenService,
		);
		if (token instanceof Response) {
			return token;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_AUTOMATION_QUERY_INVALID", "自动化凭据删除不接受参数。", 400);
		}
		const credentialId = z.string().uuid().safeParse(context.req.param("credentialId"));
		const expectedVersion = parseCredentialEtag(context.req.header("if-match"));
		if (!credentialId.success) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据标识无效。", 400);
		}
		if (!expectedVersion) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_PRECONDITION_REQUIRED",
				"请刷新内部门户凭据后再删除。",
				428,
			);
		}
		if (await requestHasNonEmptyBody(context.req.raw)) {
			return jsonError("OPS_INTERNAL_PORTAL_INPUT_INVALID", "内部门户凭据删除不接受正文。", 400);
		}
		await input.credentialService.delete(credentialId.data, expectedVersion);
		return new Response(null, {
			headers: { "cache-control": "no-store" },
			status: 204,
		});
	});
}

async function admitAutomationRequest(
	request: Request,
	automationHost: string | null,
	tokenService: InternalPortalAutomationTokenService,
): Promise<InternalPortalAutomationTokenMetadata | Response> {
	const configurationError = getAutomationConfigurationError(automationHost);
	if (configurationError) {
		return configurationError;
	}
	if (!isAutomationHostRequest(request, automationHost)) {
		return jsonError("OPS_API_ROUTE_NOT_FOUND", "未找到该运维接口。", 404);
	}
	const authorization = request.headers.get("authorization")?.trim() ?? "";
	const match = /^Bearer[ \t]+([^\s]+)$/iu.exec(authorization);
	if (!match?.[1] || match[1].length > 512) {
		return jsonError("OPS_AUTOMATION_TOKEN_INVALID", "自动化访问 token 无效。", 401);
	}
	const token = await tokenService.authenticate(match[1]);
	return token ? token : jsonError("OPS_AUTOMATION_TOKEN_INVALID", "自动化访问 token 无效。", 401);
}

function getAutomationConfigurationError(configuredValue: string | null): Response | null {
	return configuredValue
		? null
		: jsonError("OPS_AUTOMATION_NOT_CONFIGURED", "自动化访问端点尚未配置。", 503);
}

function registerDiningRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	diningContentStore: DiningContentStore;
	diningStore: DiningStore;
	publicOrigin: string | null;
}): void {
	input.app.get("/api/ops/dining", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_DINING_QUERY_INVALID", "食堂地图查询不接受参数。", 400);
		}
		return context.json(await input.diningStore.getState());
	});

	input.app.put("/api/ops/dining/draft", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const body = DiningDraftUpdateSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_DINING_DRAFT_INVALID", "食堂地图保存请求无效。", 400);
		}
		return context.json({
			draft: await input.diningStore.saveDraft(
				toDiningActor(operator),
				body.data.bundle,
				body.data.expectedRevision,
			),
		});
	});

	input.app.post("/api/ops/dining/publish", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const body = DiningRevisionSchema.safeParse(await readBoundedJson(context.req.raw, 4 * 1024));
		if (!body.success) {
			return jsonError("OPS_DINING_PUBLISH_INVALID", "食堂地图发布请求无效。", 400);
		}
		return context.json({
			release: await input.diningStore.publish(toDiningActor(operator), body.data.expectedRevision),
		});
	});

	input.app.get("/api/ops/dining/releases", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_DINING_QUERY_INVALID", "地图版本查询不接受参数。", 400);
		}
		return context.json(await input.diningStore.listReleases());
	});

	input.app.post("/api/ops/dining/releases/:releaseId/restore", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const releaseId = context.req.param("releaseId");
		const body = DiningRevisionSchema.safeParse(await readBoundedJson(context.req.raw, 4 * 1024));
		if (!(OpsPathIdSchema.safeParse(releaseId).success && body.success)) {
			return jsonError("OPS_DINING_RESTORE_INVALID", "食堂地图恢复请求无效。", 400);
		}
		return context.json(
			await input.diningStore.restore(
				toDiningActor(operator),
				releaseId,
				body.data.expectedRevision,
			),
		);
	});

	input.app.get("/api/ops/dining/menu-items", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError("OPS_DINING_QUERY_INVALID", "菜单查询不接受参数。", 400);
		}
		return context.json({ items: await input.diningContentStore.listMenuItems() });
	});

	input.app.post("/api/ops/dining/menu-items", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const body = DiningMenuItemCreateSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_DINING_MENU_INVALID", "菜品内容无效。", 400);
		}
		return context.json(
			{ item: await input.diningContentStore.createMenuItem(toDiningActor(operator), body.data) },
			201,
		);
	});

	input.app.patch("/api/ops/dining/menu-items/:menuItemId", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const menuItemId = context.req.param("menuItemId");
		const body = DiningMenuItemUpdateSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024),
		);
		if (!(OpsPathIdSchema.safeParse(menuItemId).success && body.success)) {
			return jsonError("OPS_DINING_MENU_INVALID", "菜品修改请求无效。", 400);
		}
		return context.json({
			item: await input.diningContentStore.updateMenuItem(toDiningActor(operator), menuItemId, {
				...(body.data.name ? { name: body.data.name } : {}),
				...(body.data.priceText === undefined ? {} : { priceText: body.data.priceText }),
			}),
		});
	});

	input.app.post("/api/ops/dining/menu-items/:menuItemId/move", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const menuItemId = context.req.param("menuItemId");
		const body = DiningMenuItemMoveSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024),
		);
		if (!(OpsPathIdSchema.safeParse(menuItemId).success && body.success)) {
			return jsonError("OPS_DINING_MENU_INVALID", "菜品迁移请求无效。", 400);
		}
		return context.json({
			item: await input.diningContentStore.moveMenuItem(
				toDiningActor(operator),
				menuItemId,
				body.data.windowId,
			),
		});
	});

	for (const action of ["archive", "restore"] as const) {
		input.app.post(`/api/ops/dining/menu-items/:menuItemId/${action}`, async (context) => {
			const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
			if (operator instanceof Response) {
				return operator;
			}
			const menuItemId = context.req.param("menuItemId");
			if (!OpsPathIdSchema.safeParse(menuItemId).success) {
				return jsonError("OPS_DINING_MENU_INVALID", "菜品标识无效。", 400);
			}
			const item =
				action === "archive"
					? await input.diningContentStore.archiveMenuItem(toDiningActor(operator), menuItemId)
					: await input.diningContentStore.restoreMenuItem(toDiningActor(operator), menuItemId);
			return context.json({ item });
		});
	}

	input.app.put("/api/ops/dining/windows/:windowId/menu-order", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const windowId = context.req.param("windowId");
		const body = DiningMenuOrderSchema.safeParse(await readBoundedJson(context.req.raw, 64 * 1024));
		if (!(OpsPathIdSchema.safeParse(windowId).success && body.success)) {
			return jsonError("OPS_DINING_MENU_INVALID", "菜品排序请求无效。", 400);
		}
		return context.json({
			items: await input.diningContentStore.reorderMenuItems(
				toDiningActor(operator),
				windowId,
				body.data.menuItemIds,
			),
		});
	});

	input.app.get("/api/ops/dining/reviews", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = DiningReviewListQuerySchema.safeParse(context.req.query());
		if (!query.success) {
			return jsonError("OPS_DINING_QUERY_INVALID", "评价查询参数无效。", 400);
		}
		return context.json(
			await input.diningContentStore.listReviews({
				...(query.data.cursor ? { cursor: query.data.cursor } : {}),
				limit: query.data.limit,
				...(query.data.menu_item_id ? { menuItemId: query.data.menu_item_id } : {}),
				...(query.data.q ? { q: query.data.q } : {}),
				...(query.data.visibility ? { visibility: query.data.visibility } : {}),
				...(query.data.window_id ? { windowId: query.data.window_id } : {}),
			}),
		);
	});

	input.app.get("/api/ops/dining/reviews/:reviewId", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const reviewId = context.req.param("reviewId");
		if (!OpsPathIdSchema.safeParse(reviewId).success) {
			return jsonError("OPS_DINING_REVIEW_INVALID", "评价标识无效。", 400);
		}
		return context.json(await input.diningContentStore.getReview(reviewId));
	});

	input.app.post("/api/ops/dining/reviews", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const body = DiningOpsReviewCreateSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024),
		);
		const menuItemId = OpsPathIdSchema.safeParse(context.req.query("menu_item_id"));
		const idempotencyKey = context.req.header("idempotency-key")?.trim();
		if (!(body.success && menuItemId.success && idempotencyKey) || idempotencyKey.length > 200) {
			return jsonError("OPS_DINING_REVIEW_INVALID", "评价创建请求无效。", 400);
		}
		return context.json(
			{
				review: await input.diningContentStore.createReview(toDiningActor(operator), {
					...body.data,
					idempotencyKey,
					menuItemId: menuItemId.data,
				}),
			},
			201,
		);
	});

	input.app.patch("/api/ops/dining/reviews/:reviewId", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const reviewId = context.req.param("reviewId");
		const body = DiningOpsReviewUpdateSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024),
		);
		if (!(OpsPathIdSchema.safeParse(reviewId).success && body.success)) {
			return jsonError("OPS_DINING_REVIEW_INVALID", "评价修改请求无效。", 400);
		}
		return context.json({
			review: await input.diningContentStore.updateReview(
				toDiningActor(operator),
				reviewId,
				body.data.body,
			),
		});
	});

	input.app.put("/api/ops/dining/reviews/:reviewId/visibility", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const reviewId = context.req.param("reviewId");
		const body = DiningOpsReviewVisibilitySchema.safeParse(
			await readBoundedJson(context.req.raw, 4 * 1024),
		);
		if (!(OpsPathIdSchema.safeParse(reviewId).success && body.success)) {
			return jsonError("OPS_DINING_REVIEW_INVALID", "评价可见性请求无效。", 400);
		}
		return context.json({
			review: await input.diningContentStore.setReviewVisibility(
				toDiningActor(operator),
				reviewId,
				body.data.visible,
			),
		});
	});

	input.app.delete("/api/ops/dining/reviews/:reviewId", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const reviewId = context.req.param("reviewId");
		if (!OpsPathIdSchema.safeParse(reviewId).success) {
			return jsonError("OPS_DINING_REVIEW_INVALID", "评价标识无效。", 400);
		}
		await input.diningContentStore.deleteOperatorReview(toDiningActor(operator), reviewId);
		return new Response(null, { status: 204 });
	});

	input.app.get("/api/ops/dining/reports", async (context) => {
		const operator = await admitOpsApiRequest(input.admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = DiningReportListQuerySchema.safeParse(context.req.query());
		if (!query.success) {
			return jsonError("OPS_DINING_QUERY_INVALID", "举报查询参数无效。", 400);
		}
		return context.json(
			await input.diningContentStore.listReports({
				...(query.data.cursor ? { cursor: query.data.cursor } : {}),
				limit: query.data.limit,
				status: query.data.status,
			}),
		);
	});

	input.app.post("/api/ops/dining/reviews/:reviewId/reports/resolve", async (context) => {
		const operator = await admitDiningWrite(input.admission, context.req.raw, input.publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const reviewId = context.req.param("reviewId");
		const body = DiningReportResolutionSchema.safeParse(
			await readBoundedJson(context.req.raw, 4 * 1024),
		);
		if (!(OpsPathIdSchema.safeParse(reviewId).success && body.success)) {
			return jsonError("OPS_DINING_REPORT_INVALID", "举报处理请求无效。", 400);
		}
		await input.diningContentStore.resolveReports(
			toDiningActor(operator),
			reviewId,
			body.data.resolution,
		);
		return new Response(null, { status: 204 });
	});
}

function createDefaultDiningStore(env: DiningStoreEnv): DiningStore {
	try {
		return createDiningStoreFromEnv(env);
	} catch (error) {
		return createUnavailableDiningStore(error);
	}
}

function createDefaultDiningContentStore(env: DiningStoreEnv): DiningContentStore {
	try {
		return createDiningContentStoreFromEnv(env);
	} catch (error) {
		return createUnavailableDiningContentStore(error);
	}
}

function createDefaultInternalPortalCredentialService(
	env: OpsAppEnv,
): InternalPortalCredentialService {
	try {
		return createInternalPortalCredentialService({
			store: createInternalPortalCredentialStoreFromEnv(env),
		});
	} catch (error) {
		return createInternalPortalCredentialService({
			store: createUnavailableInternalPortalCredentialStore(error),
		});
	}
}

function createDefaultInternalPortalAutomationTokenService(
	env: OpsAppEnv,
): InternalPortalAutomationTokenService {
	try {
		return createInternalPortalAutomationTokenService({
			store: createInternalPortalAutomationTokenStoreFromEnv(env),
		});
	} catch (error) {
		return createInternalPortalAutomationTokenService({
			store: createUnavailableInternalPortalAutomationTokenStore(error),
		});
	}
}

function createDefaultOpsStatusStore(env: OpsStatusEnv): OpsStatusStore {
	try {
		return createOpsStatusStoreFromEnv(env);
	} catch (error) {
		if (error instanceof PostgresTlsConfigurationError) {
			throw error;
		}
		const reasonCode = classifyReadinessError(error);
		logOpsError("ops_web.status_store_initialization", error, {
			failure_kind: reasonCode,
			source: "requests",
		});
		return createUnavailableOpsStatusStore(
			reasonCode,
			error instanceof Error ? error.message : "请求状态数据库不可用。",
		);
	}
}

function createDefaultAxiomClient(env: AxiomEnv): AxiomClient {
	try {
		return createAxiomClientFromEnv(env);
	} catch (error) {
		const unavailable = async (): Promise<never> => {
			throw error instanceof AxiomUnavailableError
				? error
				: new AxiomUnavailableError("Axiom client is unavailable.", { cause: error });
		};
		return { queryRequest: unavailable };
	}
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

async function admitOpsApiRequest(
	admission: OpsAdmission,
	request: Request,
): Promise<OpsOperatorContext | Response> {
	const result = await admission.admit(request);
	return result.operator ?? result.response;
}

async function admitDiningWrite(
	admission: OpsAdmission,
	request: Request,
	publicOrigin: string | null,
): Promise<OpsOperatorContext | Response> {
	const operator = await admitOpsApiRequest(admission, request);
	if (operator instanceof Response) {
		return operator;
	}
	if (!requestHasConfiguredOrigin(request, publicOrigin)) {
		return jsonError("OPS_DINING_ORIGIN_INVALID", "食堂修改请求来源无效。", 403);
	}
	return operator;
}

function toDiningActor(operator: OpsOperatorContext) {
	return {
		displayName: operator.displayName ?? operator.email ?? operator.operatorId,
		principalId: operator.operatorId,
	};
}

function toSearchParams(values: Record<string, unknown>): URLSearchParams {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined) {
			search.set(key, String(value));
		}
	}
	return search;
}

function isJsonContentType(value: string | null | undefined): boolean {
	if (!value) {
		return false;
	}
	try {
		return new MIMEType(value).essence === "application/json";
	} catch {
		return false;
	}
}

function validateAccountAdminWriteRequest(
	request: Request,
	publicOrigin: string | null,
): Response | { idempotencyKey: string } {
	if (!requestHasConfiguredOrigin(request, publicOrigin)) {
		return jsonError("OPS_ACCOUNT_ADMIN_CSRF_REJECTED", "用户管理写请求未通过同源校验。", 403);
	}
	if (!isJsonContentType(request.headers.get("content-type"))) {
		return jsonError(
			"OPS_ACCOUNT_ADMIN_CONTENT_TYPE_REQUIRED",
			"Content-Type 必须是 application/json。",
			400,
		);
	}
	const idempotencyKey = request.headers.get("idempotency-key")?.trim();
	if (!idempotencyKey || idempotencyKey.length > 200) {
		return jsonError(
			"OPS_ACCOUNT_ADMIN_IDEMPOTENCY_REQUIRED",
			"用户管理写请求必须提供有效的 Idempotency-Key。",
			400,
		);
	}
	return { idempotencyKey };
}

function validateEmailAccessWriteRequest(
	request: Request,
	publicOrigin: string | null,
): Response | { idempotencyKey: string } {
	if (!requestHasConfiguredOrigin(request, publicOrigin)) {
		return jsonError("OPS_EMAIL_ACCESS_CSRF_REJECTED", "账号准入写请求未通过同源校验。", 403);
	}
	if (!isJsonContentType(request.headers.get("content-type"))) {
		return jsonError(
			"OPS_EMAIL_ACCESS_CONTENT_TYPE_REQUIRED",
			"Content-Type 必须是 application/json。",
			400,
		);
	}
	const idempotencyKey = request.headers.get("idempotency-key")?.trim();
	if (!idempotencyKey || idempotencyKey.length > 200) {
		return jsonError(
			"OPS_EMAIL_ACCESS_IDEMPOTENCY_REQUIRED",
			"写请求必须提供有效的 Idempotency-Key。",
			400,
		);
	}
	return { idempotencyKey };
}

function validateInternalPortalWriteRequest(
	request: Request,
	publicOrigin: string | null,
	requireJson: boolean,
): Response | null {
	if (!requestHasConfiguredOrigin(request, publicOrigin)) {
		return jsonError("OPS_INTERNAL_PORTAL_CSRF_REJECTED", "内部门户凭据操作未通过同源校验。", 403);
	}
	if (requireJson && !isJsonContentType(request.headers.get("content-type"))) {
		return jsonError(
			"OPS_INTERNAL_PORTAL_CONTENT_TYPE_REQUIRED",
			"Content-Type 必须是 application/json。",
			400,
		);
	}
	return null;
}

function parseCredentialEtag(value: string | undefined): number | null {
	const match = /^"([1-9]\d*)"$/u.exec(value?.trim() ?? "");
	if (!match?.[1]) {
		return null;
	}
	const version = Number(match[1]);
	return Number.isSafeInteger(version) ? version : null;
}

function formatCredentialEtag(version: number): string {
	return `"${version}"`;
}

function parseCampusGroupsCatalog(value: unknown): CampusGroupsCatalog {
	const parsed = CampusGroupsCatalogSchema.safeParse(value);
	if (!parsed.success) {
		throw new CampusGroupsRequestError("同好群目录无效。");
	}
	return parsed.data;
}

function jsonError(
	code: string,
	message: string,
	status: 400 | 401 | 403 | 404 | 409 | 422 | 428 | 500 | 503 = 404,
	details?: Record<string, unknown>,
) {
	return new Response(JSON.stringify({ error: { code, message, ...details } }), {
		headers: {
			"cache-control": "no-store",
			"content-type": "application/json; charset=utf-8",
		},
		status,
	});
}

function providerConfigAdminErrorResponse(error: ProviderConfigAdminResponseError): Response {
	const details = { upstreamCode: error.upstreamCode };
	if (error.response.status === 409) {
		return jsonError(
			"OPS_PROVIDER_CONFIG_CONFLICT",
			"在线模型配置已被其他操作更新，请刷新后重试。",
			409,
			details,
		);
	}
	if (error.response.status === 400 || error.response.status === 422) {
		return jsonError(
			"OPS_PROVIDER_CONFIG_INVALID",
			providerConfigValidationMessage(error.upstreamCode),
			error.response.status,
			details,
		);
	}
	if (error.response.status === 404) {
		return jsonError("OPS_PROVIDER_CONFIG_NOT_FOUND", "未找到对应的在线模型配置。", 404, details);
	}
	return jsonError(
		"OPS_PROVIDER_CONFIG_COMMAND_FAILED",
		"在线模型配置操作失败。",
		error.response.status >= 500 ? 503 : 500,
		details,
	);
}

function providerConfigValidationMessage(upstreamCode: string) {
	return (
		{
			invalid_response: "模型服务返回了无法识别的响应。",
			invalid_setting: "在线模型配置内容无效。",
			provider_unavailable: "无法连接模型服务，请检查地址和网络。",
			provider_timeout: "连接模型服务超时，请检查地址和网络。",
		}[upstreamCode] ?? "在线模型配置内容无效，请检查填写内容。"
	);
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
	const contentLengthHeader = request.headers.get("content-length");
	if (contentLengthHeader !== null) {
		const contentLength = Number(contentLengthHeader);
		if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maxBytes) {
			return null;
		}
	}
	if (!request.body) {
		return null;
	}

	try {
		const reader = request.body.getReader();
		try {
			const chunks: Uint8Array[] = [];
			let totalBytes = 0;
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) {
					break;
				}
				totalBytes += chunk.value.byteLength;
				if (totalBytes > maxBytes) {
					await reader.cancel("request body exceeds limit");
					return null;
				}
				chunks.push(chunk.value);
			}

			const body = new Uint8Array(totalBytes);
			let offset = 0;
			for (const chunk of chunks) {
				body.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return JSON.parse(new TextDecoder().decode(body)) as unknown;
		} finally {
			reader.releaseLock();
		}
	} catch {
		return null;
	}
}

async function requestHasNonEmptyBody(request: Request): Promise<boolean> {
	const contentLengthHeader = request.headers.get("content-length");
	if (contentLengthHeader !== null) {
		const contentLength = Number(contentLengthHeader);
		if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > 0) {
			return true;
		}
	}
	if (!request.body) {
		return false;
	}

	try {
		const reader = request.body.getReader();
		try {
			const chunk = await reader.read();
			if (chunk.done) {
				return false;
			}
			await reader.cancel("request body is not allowed");
			return true;
		} finally {
			reader.releaseLock();
		}
	} catch {
		return true;
	}
}

function isStaticAssetPath(path: string) {
	return /\.[A-Za-z0-9]+$/.test(path.split("/").at(-1) ?? "");
}

function requestHasConfiguredOrigin(request: Request, publicOrigin: string | null) {
	if (!publicOrigin) {
		return false;
	}
	const fetchSite = request.headers.get("sec-fetch-site");
	if (fetchSite && fetchSite !== "same-origin") {
		return false;
	}
	const origin = request.headers.get("origin")?.trim();
	if (!origin) {
		return false;
	}
	try {
		return new URL(origin).origin === origin && origin === publicOrigin;
	} catch {
		return false;
	}
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

function isAutomationHostRequest(request: Request, automationHost: string | null): boolean {
	if (!automationHost) {
		return false;
	}
	try {
		return new URL(request.url).host === automationHost;
	} catch {
		return false;
	}
}

function isAutomationHostPath(path: string): boolean {
	return path === "/healthz" || path === "/readyz" || path.startsWith("/api/automation/");
}
