import { DiningDomainError } from "@campus-agent/dining/domain";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import {
	OpsInternalPortalAuthStatusSchema,
	OpsInternalPortalAuthUpdateSchema,
	OpsObservabilityResponseSchema,
	OpsOverviewResponseSchema,
	OpsOverviewWindowSchema,
	OpsRequestDetailResponseSchema,
	OpsRequestListResponseSchema,
	OpsRequestWindowSchema,
} from "../shared/ops-contract.ts";
import {
	type AxiomClient,
	type AxiomEnv,
	AxiomUnavailableError,
	createAxiomClientFromEnv,
} from "./axiom-client.ts";
import {
	createDiningStoreFromEnv,
	createUnavailableDiningStore,
	type DiningStore,
	type DiningStoreEnv,
	DiningStoreNotFoundError,
	DiningStoreUnavailableError,
	DiningStoreValidationError,
} from "./dining-store.ts";
import {
	createInternalPortalAuthMaintenanceClientFromEnv,
	type InternalPortalAuthMaintenanceClient,
	type InternalPortalAuthMaintenanceEnv,
	InternalPortalAuthMaintenanceUnavailableError,
	unavailableMaintenanceStatus,
} from "./internal-portal-auth-maintenance-client.ts";
import {
	createKubernetesInternalPortalAuthStore,
	createUnavailableInternalPortalAuthStore,
	type InternalPortalAuthStore,
	InternalPortalAuthStoreUnavailableError,
	parseInternalPortalCredential,
} from "./internal-portal-auth-store.ts";
import {
	createCloudflareAccessOpsAdmission,
	getMissingAccessConfig,
	type OpsAdmission,
	type OpsAdmissionEnv,
	type OpsOperatorContext,
	operatorCanReadRawObservability,
	operatorCanWriteProviderConfig,
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

interface OpsHealthEnv {
	OPS_WEB_HEALTH_AGENT_RUNTIME_URL?: string;
	OPS_WEB_HEALTH_APP_API_URL?: string;
	OPS_WEB_HEALTH_CAMPUS_WEB_URL?: string;
	OPS_WEB_HEALTH_EXECUTION_CONTROL_URL?: string;
	OPS_WEB_HEALTH_OPS_WEB_URL?: string;
	OPS_WEB_PUBLIC_ORIGIN?: string;
}

type OpsAppEnv = OpsAdmissionEnv &
	AxiomEnv &
	DiningStoreEnv &
	InternalPortalAuthMaintenanceEnv &
	OpsHealthEnv &
	OpsStatusEnv &
	ProviderConfigAdminEnv;

interface OpsAppOptions {
	admission?: OpsAdmission;
	axiom?: AxiomClient;
	env?: OpsAppEnv;
	diningStore?: DiningStore;
	internalPortalAuthStore?: InternalPortalAuthStore;
	internalPortalMaintenanceClient?: InternalPortalAuthMaintenanceClient;
	overviewService?: OpsOverviewService;
	staticRoot?: string;
	store?: OpsStatusStore;
	providerConfigClient?: ReturnType<typeof createProviderConfigAdminClient>;
}

const RequestListQuerySchema = z
	.object({
		conversationId: z.string().trim().min(1).max(128).optional(),
		cursor: z.string().trim().min(1).max(512).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
		q: z.string().trim().min(1).max(256).optional(),
		requestId: z.string().trim().min(1).max(128).optional(),
		status: z.enum(["COMPLETED", "FAILED", "CANCELLED", "RUNNING", "PENDING"]).optional(),
		traceId: z.string().trim().min(1).max(128).optional(),
		window: OpsRequestWindowSchema.default("1h"),
	})
	.strict();
const OverviewQuerySchema = z.object({ window: OpsOverviewWindowSchema.default("1h") }).strict();
const ObservabilityQuerySchema = z.object({ kind: z.enum(["logs", "trace"]) }).strict();
const DiningLimitQuerySchema = z
	.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
	.strict();
const DiningNotesSchema = z.object({ notes: z.string().trim().min(1).max(500) }).strict();
const DiningCatalogCommandSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("rename_stall"),
			stallProfileId: z.string().min(1),
			displayName: z.string().trim().min(1).max(120),
		})
		.strict(),
	z
		.object({
			kind: z.literal("set_offering_price"),
			offeringId: z.string().min(1),
			priceLabel: z.string().trim().max(40).nullable(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("assign_stall"),
			windowId: z.string().min(1),
			stallProfileId: z.string().min(1),
			displayName: z.string().trim().min(1).max(120),
			tags: z.array(z.string().trim().min(1).max(40)).max(20),
		})
		.strict(),
	z.object({ kind: z.literal("remove_assignment"), assignmentId: z.string().min(1) }).strict(),
]);
const DiningReviewCommandSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("hide"), reason: z.string().trim().min(1).max(300) }).strict(),
	z.object({ kind: z.literal("restore"), reason: z.string().trim().min(1).max(300) }).strict(),
	z
		.object({
			kind: z.literal("rebind"),
			offeringId: z.string().min(1),
			reason: z.string().trim().min(1).max(300),
		})
		.strict(),
	z.object({ kind: z.literal("recheck") }).strict(),
]);
const OpsPathIdSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[A-Za-z0-9._:-]+$/);

export function createOpsApp(options: OpsAppOptions = {}) {
	const app = new Hono();
	const env = options.env ?? process.env;
	const publicOrigin = resolveOpsPublicOrigin(env);
	const diningStore = options.diningStore ?? createDefaultDiningStore(env);
	const admission = options.admission ?? createCloudflareAccessOpsAdmission(env);
	const internalPortalAuthStore =
		options.internalPortalAuthStore ?? createDefaultInternalPortalAuthStore();
	const internalPortalMaintenanceClient =
		options.internalPortalMaintenanceClient ??
		createInternalPortalAuthMaintenanceClientFromEnv(env);
	const staticRoot = options.staticRoot ?? "dist";
	const store = options.store ?? createDefaultOpsStatusStore(env);
	const axiom = options.axiom ?? createDefaultAxiomClient(env);
	const overviewService =
		options.overviewService ??
		createOpsOverviewService({
			signals: createOpsRuntimeSignalsSource({
				healthUrls: {
					"agent-runtime": env.OPS_WEB_HEALTH_AGENT_RUNTIME_URL,
					"app-api": env.OPS_WEB_HEALTH_APP_API_URL,
					"campus-web": env.OPS_WEB_HEALTH_CAMPUS_WEB_URL,
					"execution-control": env.OPS_WEB_HEALTH_EXECUTION_CONTROL_URL,
					"ops-web": env.OPS_WEB_HEALTH_OPS_WEB_URL,
				},
				axiom,
			}),
			store,
		});
	const providerConfigClient = options.providerConfigClient ?? createProviderConfigAdminClient(env);

	app.use(
		"*",
		secureHeaders({
			contentSecurityPolicy: {
				baseUri: ["'self'"],
				connectSrc: ["'self'"],
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
		console.error("[ops-web] unhandled api error", error);
		if (error instanceof AxiomUnavailableError) {
			return jsonError("OPS_OBSERVABILITY_UNAVAILABLE", "Axiom 数据不可用。", 503);
		}
		if (error instanceof ProviderConfigAdminUnavailableError) {
			return jsonError("OPS_PROVIDER_CONFIG_UNAVAILABLE", "Provider Config 后端不可用。", 503);
		}
		if (error instanceof ProviderConfigAdminResponseError) {
			return error.response;
		}
		if (error instanceof DiningStoreUnavailableError) {
			return jsonError("OPS_DINING_STORE_UNAVAILABLE", "食堂管理数据库不可用。", 503);
		}
		if (error instanceof DiningStoreNotFoundError) {
			return jsonError("OPS_DINING_NOT_FOUND", "未找到对应的食堂数据。", 404);
		}
		if (error instanceof DiningStoreValidationError) {
			return jsonError("OPS_DINING_CONFLICT", error.message, 409);
		}
		if (error instanceof DiningDomainError) {
			return jsonError(
				error.code,
				error.message,
				error.status === 409 ? 409 : 400,
				error.details && typeof error.details === "object" && !Array.isArray(error.details)
					? (error.details as Record<string, unknown>)
					: undefined,
			);
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
			await store.verifyObservabilityReadAuditWrite();
			await diningStore.verifyReadiness();
			return context.json({ ok: true, service: "ops-web" });
		} catch (error) {
			const reasonCode = classifyReadinessError(error);
			console.error("[ops-web] readiness check failed", {
				message: error instanceof Error ? error.message : String(error),
				reasonCode,
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

	app.get("/api/ops/internal-portal-auth", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (operator.principalClass !== "human") {
			return internalPortalAuthForbiddenResponse();
		}
		try {
			const credential = await internalPortalAuthStore.getStatus();
			const maintenance = await readInternalPortalMaintenanceStatus(
				internalPortalMaintenanceClient,
			);
			return context.json(
				OpsInternalPortalAuthStatusSchema.parse(
					buildInternalPortalAuthStatus(credential, maintenance),
				),
			);
		} catch (error) {
			return internalPortalAuthErrorResponse(error);
		}
	});

	app.put(
		"/api/ops/internal-portal-auth",
		bodyLimit({ maxSize: 8 * 1024, onError: invalidInternalPortalCredentialResponse }),
		async (context) => {
			const operator = await admitOpsApiRequest(admission, context.req.raw);
			if (operator instanceof Response) {
				return operator;
			}
			if (operator.principalClass !== "human") {
				return internalPortalAuthForbiddenResponse();
			}
			if (!requestHasConfiguredOrigin(context.req.raw, publicOrigin)) {
				return jsonError("OPS_INTERNAL_PORTAL_AUTH_ORIGIN_INVALID", "凭据更新请求来源无效。", 403);
			}

			const body = await readBoundedJson(context.req.raw, 8 * 1024);
			const parsed = OpsInternalPortalAuthUpdateSchema.safeParse(body);
			if (!parsed.success) {
				return invalidInternalPortalCredentialResponse();
			}
			let credential: string;
			try {
				credential = parseInternalPortalCredential(parsed.data.credential);
			} catch {
				return invalidInternalPortalCredentialResponse();
			}

			try {
				const updatedAt = new Date().toISOString();
				const credentialStatus = await internalPortalAuthStore.replaceCredential({
					credential,
					updatedAt,
					updatedBy: operator.operatorId,
				});
				const maintenance = await resumeInternalPortalMaintenanceSafely(
					internalPortalMaintenanceClient,
				);
				const status = OpsInternalPortalAuthStatusSchema.parse(
					buildInternalPortalAuthStatus(credentialStatus, maintenance),
				);
				console.info("[ops-web] internal portal credential replaced", {
					operatorId: operator.operatorId,
					updatedAt,
				});
				return context.json(status);
			} catch (error) {
				return internalPortalAuthErrorResponse(error);
			}
		},
	);

	app.post("/api/ops/internal-portal-auth/maintenance/resume", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (operator.principalClass !== "human") {
			return internalPortalAuthForbiddenResponse();
		}
		if (!requestHasConfiguredOrigin(context.req.raw, publicOrigin)) {
			return jsonError("OPS_INTERNAL_PORTAL_AUTH_ORIGIN_INVALID", "恢复请求来源无效。", 403);
		}
		try {
			const maintenance = await internalPortalMaintenanceClient.resume();
			const credential = await internalPortalAuthStore.getStatus();
			return context.json(
				OpsInternalPortalAuthStatusSchema.parse(
					buildInternalPortalAuthStatus(credential, maintenance),
				),
			);
		} catch (error) {
			return error instanceof InternalPortalAuthMaintenanceUnavailableError
				? jsonError(
						"OPS_INTERNAL_PORTAL_AUTH_MAINTENANCE_UNAVAILABLE",
						"门户认证维护暂时不可用。",
						503,
					)
				: internalPortalAuthErrorResponse(error);
		}
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
			await overviewService.getOverview(parsed.data.window),
		);
		context.header("cache-control", "private, max-age=15, stale-if-error=300");
		return context.json(response);
	});

	app.get("/api/ops/provider-config", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		return context.json({
			...(await providerConfigClient.getStatus()),
			writeAllowed: operatorCanWriteProviderConfig(operator, env),
		});
	});

	app.post("/api/ops/provider-config/*", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		if (!operatorCanWriteProviderConfig(operator, env)) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_WRITE_FORBIDDEN",
				"当前操作者无权修改 Provider Config。",
				403,
			);
		}
		if (!requestHasConfiguredOrigin(context.req.raw, publicOrigin)) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_CSRF_REJECTED",
				"Provider Config 写请求未通过同源校验。",
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
		const suffix = context.req.path.slice("/api/ops/provider-config".length);
		if (!providerCommandPathAllowed(suffix)) {
			return jsonError("OPS_API_ROUTE_NOT_FOUND", "未找到该运维接口。", 404);
		}
		const body = await context.req.json().catch(() => null);
		if (body === null) {
			return jsonError("OPS_INVALID_JSON", "请求体必须是有效 JSON。", 400);
		}
		const idempotencyKey = context.req.header("idempotency-key")?.trim();
		if (!idempotencyKey || idempotencyKey.length > 200) {
			return jsonError(
				"OPS_PROVIDER_CONFIG_IDEMPOTENCY_REQUIRED",
				"Provider Config 写请求必须提供有效的 Idempotency-Key。",
				400,
			);
		}
		const result = await providerConfigClient.command(
			suffix,
			body,
			operator.operatorId,
			idempotencyKey,
		);
		return context.json(result);
	});

	app.get("/api/ops/requests", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const parsed = RequestListQuerySchema.safeParse(context.req.query());
		if (!parsed.success) {
			return jsonError("OPS_INVALID_QUERY", "请求列表查询参数无效。", 400);
		}
		if (parsed.data.cursor && !decodeRequestCursor(parsed.data.cursor)) {
			return jsonError("OPS_INVALID_QUERY", "请求列表翻页参数无效。", 400);
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
		if (!operatorCanReadRawObservability(operator, env)) {
			return jsonError(
				"OPS_RAW_OBSERVABILITY_FORBIDDEN",
				"当前操作者无权读取原始日志和调用链。",
				403,
			);
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
				startedAt: detail.request.startedAt,
				traceId: detail.request.traceId,
			}),
		);
		await store.writeObservabilityReadAudit({
			kind: response.kind,
			operatorId: operator.operatorId,
			operatorPrincipalClass: operator.principalClass,
			readAt: new Date().toISOString(),
			recordCount: response.records.length,
			requestId: response.requestId,
			traceId: response.traceId,
			truncated: response.truncated,
		});
		return context.json(response);
	});

	app.get("/api/ops/dining/overview", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		return operator instanceof Response ? operator : context.json(await diningStore.getOverview());
	});
	app.get("/api/ops/dining/source-runs", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = DiningLimitQuerySchema.safeParse(context.req.query());
		return query.success
			? context.json({ runs: await diningStore.listSourceRuns(query.data.limit) })
			: jsonError("OPS_INVALID_QUERY", "食堂同步记录查询无效。", 400);
	});
	app.get("/api/ops/dining/observations", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = DiningLimitQuerySchema.safeParse(context.req.query());
		return query.success
			? context.json({ observations: await diningStore.listObservations(query.data.limit) })
			: jsonError("OPS_INVALID_QUERY", "食堂采集记录查询无效。", 400);
	});
	app.get("/api/ops/dining/catalog/draft", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		return operator instanceof Response
			? operator
			: context.json({ draft: await diningStore.getDraft() });
	});
	app.get("/api/ops/dining/catalog/draft/validation", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		return operator instanceof Response
			? operator
			: context.json({ validation: await diningStore.validate() });
	});
	app.post("/api/ops/dining/catalog/draft/rebase", async (context) => {
		const operator = await admitDiningWrite(admission, context.req.raw, publicOrigin);
		return operator instanceof Response
			? operator
			: context.json({ draft: await diningStore.rebase(toDiningActor(operator)) });
	});
	app.post("/api/ops/dining/catalog/draft/commands", async (context) => {
		const operator = await admitDiningWrite(admission, context.req.raw, publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const command = DiningCatalogCommandSchema.safeParse(
			await readBoundedJson(context.req.raw, 16 * 1024),
		);
		return command.success
			? context.json({
					draft: await diningStore.applyCatalogCommand(toDiningActor(operator), command.data),
				})
			: jsonError("OPS_DINING_COMMAND_INVALID", "食堂草稿操作无效。", 400);
	});
	app.post("/api/ops/dining/catalog/publish", async (context) => {
		const operator = await admitDiningWrite(admission, context.req.raw, publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const body = DiningNotesSchema.safeParse(await readBoundedJson(context.req.raw, 4 * 1024));
		return body.success
			? context.json(await diningStore.publish(toDiningActor(operator), body.data.notes), 201)
			: jsonError("OPS_DINING_PUBLISH_INVALID", "食堂发布说明无效。", 400);
	});
	app.get("/api/ops/dining/releases", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		return operator instanceof Response
			? operator
			: context.json({ releases: await diningStore.listReleases() });
	});
	app.get("/api/ops/dining/releases/:releaseId", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const release = await diningStore.getRelease(context.req.param("releaseId"));
		return release
			? context.json(release)
			: jsonError("OPS_DINING_NOT_FOUND", "未找到该食堂发布。", 404);
	});
	app.post("/api/ops/dining/releases/:releaseId/rollback", async (context) => {
		const operator = await admitDiningWrite(admission, context.req.raw, publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const body = DiningNotesSchema.safeParse(await readBoundedJson(context.req.raw, 4 * 1024));
		return body.success
			? context.json(
					await diningStore.rollback(
						toDiningActor(operator),
						context.req.param("releaseId"),
						body.data.notes,
					),
					201,
				)
			: jsonError("OPS_DINING_ROLLBACK_INVALID", "回滚说明无效。", 400);
	});
	app.get("/api/ops/dining/reviews", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const query = DiningLimitQuerySchema.safeParse(context.req.query());
		return query.success
			? context.json({ reviews: await diningStore.listReviews(query.data.limit) })
			: jsonError("OPS_INVALID_QUERY", "评价查询无效。", 400);
	});
	app.get("/api/ops/dining/reviews/:reviewId", async (context) => {
		const operator = await admitOpsApiRequest(admission, context.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		const review = await diningStore.getReview(context.req.param("reviewId"));
		return review
			? context.json({ review })
			: jsonError("OPS_DINING_NOT_FOUND", "未找到该评价。", 404);
	});
	app.post("/api/ops/dining/reviews/:reviewId/commands", async (context) => {
		const operator = await admitDiningWrite(admission, context.req.raw, publicOrigin);
		if (operator instanceof Response) {
			return operator;
		}
		const command = DiningReviewCommandSchema.safeParse(
			await readBoundedJson(context.req.raw, 4 * 1024),
		);
		if (!command.success) {
			return jsonError("OPS_DINING_REVIEW_COMMAND_INVALID", "评价操作无效。", 400);
		}
		await diningStore.applyReviewCommand(
			toDiningActor(operator),
			context.req.param("reviewId"),
			command.data,
		);
		return context.json({ ok: true });
	});

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

function createDefaultInternalPortalAuthStore(): InternalPortalAuthStore {
	try {
		return createKubernetesInternalPortalAuthStore();
	} catch (error) {
		return createUnavailableInternalPortalAuthStore(
			error instanceof InternalPortalAuthStoreUnavailableError
				? error.reasonCode
				: "KUBERNETES_CONFIG_UNAVAILABLE",
		);
	}
}

function createDefaultDiningStore(env: DiningStoreEnv): DiningStore {
	try {
		return createDiningStoreFromEnv(env);
	} catch (error) {
		return createUnavailableDiningStore(error);
	}
}

async function readInternalPortalMaintenanceStatus(client: InternalPortalAuthMaintenanceClient) {
	try {
		return await client.getStatus();
	} catch (error) {
		console.error("[ops-web] internal portal auth maintenance query failed", {
			message: error instanceof Error ? error.message : String(error),
		});
		return unavailableMaintenanceStatus();
	}
}

async function resumeInternalPortalMaintenanceSafely(client: InternalPortalAuthMaintenanceClient) {
	try {
		return await client.resume();
	} catch (error) {
		console.error("[ops-web] internal portal auth maintenance resume failed", {
			message: error instanceof Error ? error.message : String(error),
		});
		return unavailableMaintenanceStatus();
	}
}

function buildInternalPortalAuthStatus(
	credential: Awaited<ReturnType<InternalPortalAuthStore["getStatus"]>>,
	maintenance: Awaited<ReturnType<InternalPortalAuthMaintenanceClient["getStatus"]>>,
) {
	const updatedAt = timestampMs(credential.updatedAt);
	const lastSuccessAt = timestampMs(maintenance.lastSuccessAt);
	const lastAttemptAt = timestampMs(maintenance.lastAttemptAt);
	const lowerBoundSeconds =
		updatedAt !== null && lastSuccessAt !== null && lastSuccessAt >= updatedAt
			? Math.floor((lastSuccessAt - updatedAt) / 1_000)
			: null;
	const upperBoundSeconds =
		updatedAt !== null &&
		lastAttemptAt !== null &&
		lastAttemptAt >= updatedAt &&
		maintenance.lastOutcome === "CREDENTIAL_EXPIRED"
			? Math.ceil((lastAttemptAt - updatedAt) / 1_000)
			: null;
	return {
		...credential,
		maintenance,
		observedLifetime: { lowerBoundSeconds, upperBoundSeconds },
	};
}

function timestampMs(value: string | null): number | null {
	if (!value) {
		return null;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function createDefaultOpsStatusStore(env: OpsStatusEnv): OpsStatusStore {
	try {
		return createOpsStatusStoreFromEnv(env);
	} catch (error) {
		if (error instanceof PostgresTlsConfigurationError) {
			throw error;
		}
		const reasonCode = classifyReadinessError(error);
		console.error("[ops-web] status store initialization failed", {
			message: error instanceof Error ? error.message : String(error),
			reasonCode,
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
	if (operator.principalClass !== "human") {
		return jsonError("OPS_DINING_WRITE_FORBIDDEN", "服务身份不能修改食堂数据。", 403);
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

function internalPortalAuthForbiddenResponse(): Response {
	return jsonError("OPS_INTERNAL_PORTAL_AUTH_FORBIDDEN", "当前操作者无权管理内部门户认证。", 403);
}

function invalidInternalPortalCredentialResponse(): Response {
	return jsonError("OPS_INTERNAL_PORTAL_AUTH_INPUT_INVALID", "内部门户凭据格式无效。", 400);
}

function internalPortalAuthErrorResponse(error: unknown): Response {
	if (!(error instanceof InternalPortalAuthStoreUnavailableError)) {
		return jsonError("OPS_INTERNAL_PORTAL_AUTH_UNAVAILABLE", "内部门户认证存储暂时不可用。", 503);
	}
	if (error.reasonCode === "SECRET_NOT_INITIALIZED") {
		return jsonError(
			"OPS_INTERNAL_PORTAL_AUTH_NOT_INITIALIZED",
			"内部门户认证 Secret 尚未初始化。",
			503,
		);
	}
	return jsonError("OPS_INTERNAL_PORTAL_AUTH_UNAVAILABLE", "内部门户认证存储暂时不可用。", 503, {
		reasonCode: error.reasonCode,
	});
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
	const configured = env.OPS_WEB_PUBLIC_ORIGIN?.trim();
	if (!configured) {
		return null;
	}
	try {
		const parsed = new URL(configured);
		return parsed.protocol === "https:" && parsed.origin === configured ? parsed.origin : null;
	} catch {
		return null;
	}
}

function providerCommandPathAllowed(path: string) {
	return (
		path === "/connections" ||
		path === "/profiles" ||
		path === "/activation" ||
		/^\/profiles\/[A-Za-z0-9._:-]+\/validate$/u.test(path)
	);
}
