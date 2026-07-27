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
	type CampusGroupsCatalog,
	CampusGroupsCatalogSchema,
} from "campus-contracts/campus-groups";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { DiningDraftUpdateSchema, DiningRevisionSchema } from "../shared/dining-contract.ts";
import {
	InternalPortalAuthStatusSchema,
	InternalPortalAuthUpdateSchema,
	ModelSettingKindSchema,
	ModelSettingUpdateSchema,
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
	createClusterInternalPortalAuthClient,
	type InternalPortalAuthClient,
	InternalPortalAuthUnavailableError,
} from "./internal-portal-auth-client.ts";
import {
	createCloudflareAccessOpsAdmission,
	getMissingAccessConfig,
	type OpsAdmission,
	type OpsAdmissionEnv,
	type OpsOperatorContext,
} from "./ops-admission.ts";
import { createOpsOverviewService, type OpsOverviewService } from "./ops-overview-service.ts";
import { createOpsRuntimeSignalsSource } from "./ops-runtime-signals.ts";
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
	OPS_WEB_AGENT_RUNTIME_URL?: string;
	OPS_WEB_APP_API_URL?: string;
	OPS_WEB_CAMPUS_WEB_URL?: string;
	OPS_WEB_EXECUTION_CONTROL_URL?: string;
	OPS_WEB_PUBLIC_ORIGIN?: string;
}

type OpsAppEnv = OpsAdmissionEnv &
	AxiomEnv &
	CampusGroupsAdminEnv &
	DiningStoreEnv &
	OpsHealthEnv &
	OpsStatusEnv &
	ProviderConfigAdminEnv &
	SentryEnv;

interface OpsAppOptions {
	admission?: OpsAdmission;
	axiom?: AxiomClient;
	env?: OpsAppEnv;
	diningStore?: DiningStore;
	diningContentStore?: DiningContentStore;
	overviewService?: OpsOverviewService;
	sentry?: SentryClient;
	staticRoot?: string;
	store?: OpsStatusStore;
	internalPortalAuthClient?: InternalPortalAuthClient;
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
const ObservabilityQuerySchema = z.object({ kind: z.enum(["logs", "trace"]) }).strict();
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
	const diningStore = options.diningStore ?? createDefaultDiningStore(env);
	const diningContentStore = options.diningContentStore ?? createDefaultDiningContentStore(env);
	const admission = options.admission ?? createCloudflareAccessOpsAdmission(env);
	const staticRoot = options.staticRoot ?? "dist";
	const store = options.store ?? createDefaultOpsStatusStore(env);
	const axiom = options.axiom ?? createDefaultAxiomClient(env);
	const sentry = options.sentry ?? createDefaultSentryClient(env);
	const overviewService =
		options.overviewService ??
		createOpsOverviewService({
			signals: createOpsRuntimeSignalsSource({
				healthUrls: {
					"agent-runtime": env.OPS_WEB_AGENT_RUNTIME_URL,
					"app-api": env.OPS_WEB_APP_API_URL,
					"campus-web": env.OPS_WEB_CAMPUS_WEB_URL,
					"execution-control": env.OPS_WEB_EXECUTION_CONTROL_URL,
				},
				internalToken: env.OPS_WEB_INTERNAL_TOKEN,
				axiom,
			}),
			store,
		});
	const providerConfigClient = options.providerConfigClient ?? createProviderConfigAdminClient(env);
	const internalPortalAuthClient =
		options.internalPortalAuthClient ?? createClusterInternalPortalAuthClient();
	const campusGroupsClient =
		options.campusGroupsClient ??
		createCampusGroupsAdminClient({
			OPS_WEB_APP_API_URL: env.OPS_WEB_APP_API_URL,
			OPS_WEB_INTERNAL_TOKEN: env.OPS_WEB_INTERNAL_TOKEN,
		});

	app.use(
		"*",
		secureHeaders({
			contentSecurityPolicy: {
				baseUri: ["'self'"],
				connectSrc: ["'self'", "blob:"],
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

	app.onError((error) => {
		logOpsError("unhandled api error", error, { source: "http" });
		if (error instanceof AxiomUnavailableError) {
			return jsonError("OPS_OBSERVABILITY_UNAVAILABLE", "Axiom 数据不可用。", 503);
		}
		if (error instanceof SentryUnavailableError) {
			return jsonError("OPS_SENTRY_UNAVAILABLE", "Sentry Issue 数据不可用。", 503);
		}
		if (error instanceof ProviderConfigAdminUnavailableError) {
			return jsonError("OPS_PROVIDER_CONFIG_UNAVAILABLE", "在线模型配置服务暂不可用。", 503);
		}
		if (error instanceof ProviderConfigAdminResponseError) {
			return providerConfigAdminErrorResponse(error);
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
		if (error instanceof InternalPortalAuthUnavailableError) {
			return jsonError("OPS_INTERNAL_PORTAL_AUTH_UNAVAILABLE", "内部门户认证资源暂不可用。", 503);
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
			const missingAccessConfig = getMissingAccessConfig(env);
			if (!publicOrigin) {
				missingAccessConfig.push("OPS_WEB_PUBLIC_ORIGIN");
			}
			if (missingAccessConfig.length > 0) {
				return context.json(
					{
						error: {
							code: "OPS_WEB_NOT_READY",
							message: "访问控制未配置。",
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
			logOpsError("readiness check failed", error, { reasonCode, source: "readiness" });
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

	app.get("/api/ops/internal-portal/auth", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_AUTH_QUERY_INVALID",
				"内部门户认证状态查询不接受参数。",
				400,
			);
		}
		return context.json(
			InternalPortalAuthStatusSchema.parse(await internalPortalAuthClient.getStatus()),
		);
	});

	app.put("/api/ops/internal-portal/auth", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (!requestHasConfiguredOrigin(context.req.raw, publicOrigin)) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_AUTH_ORIGIN_INVALID",
				"内部门户认证修改请求来源无效。",
				403,
			);
		}
		if (!context.req.header("content-type")?.toLowerCase().startsWith("application/json")) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_AUTH_CONTENT_TYPE_REQUIRED",
				"Content-Type 必须是 application/json。",
				400,
			);
		}
		if (Object.keys(context.req.query()).length > 0) {
			return jsonError(
				"OPS_INTERNAL_PORTAL_AUTH_QUERY_INVALID",
				"内部门户认证修改不接受查询参数。",
				400,
			);
		}
		const body = InternalPortalAuthUpdateSchema.safeParse(
			await readBoundedJson(context.req.raw, 8 * 1024),
		);
		if (!body.success) {
			return jsonError("OPS_INTERNAL_PORTAL_AUTH_INVALID", "请输入原始 SSO_TGC 值。", 400);
		}
		return context.json(
			InternalPortalAuthStatusSchema.parse(
				await internalPortalAuthClient.replaceCredential(body.data.ssoTgc),
			),
		);
	});

	app.get("/api/ops/model-settings/execution", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		return context.json(await providerConfigClient.getStatus());
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
		if (!context.req.header("content-type")?.toLowerCase().startsWith("application/json")) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_CONTENT_TYPE_REQUIRED",
				"Content-Type 必须是 application/json。",
				400,
			);
		}
		const kind = ModelSettingKindSchema.safeParse(context.req.param("kind"));
		const body = ModelSettingUpdateSchema.safeParse(await context.req.json().catch(() => null));
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
		return context.json(OpsRequestListResponseSchema.parse(await store.listRequests(parsed.data)));
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
			return jsonError("OPS_INVALID_QUERY", "日志或调用链查询参数无效。", 400);
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
				traceId: detail.technical.correlationIds.traceId,
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
					traceId: detail.technical.correlationIds.traceId,
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
		await next();
	});
	app.get("*", serveStatic({ path: "index.html", root: staticRoot }));
	return app;
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
			item: await input.diningContentStore.updateMenuItem(
				toDiningActor(operator),
				menuItemId,
				body.data,
			),
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
				cursor: query.data.cursor,
				limit: query.data.limit,
				menuItemId: query.data.menu_item_id,
				q: query.data.q,
				visibility: query.data.visibility,
				windowId: query.data.window_id,
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
		return context.json(await input.diningContentStore.listReports(query.data));
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

function createDefaultOpsStatusStore(env: OpsStatusEnv): OpsStatusStore {
	try {
		return createOpsStatusStoreFromEnv(env);
	} catch (error) {
		if (error instanceof PostgresTlsConfigurationError) {
			throw error;
		}
		const reasonCode = classifyReadinessError(error);
		logOpsError("status store initialization failed", error, {
			reasonCode,
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
		return { getTelemetrySnapshot: unavailable, queryRequest: unavailable };
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
	status: 400 | 403 | 404 | 409 | 422 | 500 | 503 = 404,
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
			dimension_mismatch: "Embedding 返回的向量维度与固定配置不一致。",
			invalid_response: "模型服务返回了无法识别的响应。",
			provider_timeout: "连接模型服务超时，请检查地址和网络。",
			provider_unavailable: "无法连接模型服务，请检查地址和网络。",
		}[upstreamCode] ?? "在线模型配置内容无效，请检查填写内容。"
	);
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
	const contentLength = Number(request.headers.get("content-length") ?? "0");
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		return null;
	}
	try {
		const body = await request.text();
		if (new TextEncoder().encode(body).byteLength > maxBytes) {
			return null;
		}
		return JSON.parse(body) as unknown;
	} catch {
		return null;
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
