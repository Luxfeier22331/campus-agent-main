import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import {
	OpsObservabilityResponseSchema,
	OpsOverviewResponseSchema,
	OpsOverviewWindowSchema,
	OpsRequestDetailResponseSchema,
	OpsRequestListResponseSchema,
	OpsRequestWindowSchema,
} from "../shared/ops-contract.ts";
import {
	createOpenObserveClientFromEnv,
	type OpenObserveClient,
	type OpenObserveEnv,
	OpenObserveUnavailableError,
} from "./openobserve-client.ts";
import {
	createCloudflareAccessOpsAdmission,
	getMissingAccessConfig,
	type OpsAdmission,
	type OpsAdmissionEnv,
	type OpsOperatorContext,
	operatorCanReadRawObservability,
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

interface OpsHealthEnv {
	OPS_WEB_HEALTH_AGENT_RUNTIME_URL?: string;
	OPS_WEB_HEALTH_APP_API_URL?: string;
	OPS_WEB_HEALTH_CAMPUS_WEB_URL?: string;
	OPS_WEB_HEALTH_EXECUTION_CONTROL_URL?: string;
	OPS_WEB_HEALTH_OPS_WEB_URL?: string;
}

type OpsAppEnv = OpsAdmissionEnv & OpenObserveEnv & OpsHealthEnv & OpsStatusEnv;

interface OpsAppOptions {
	admission?: OpsAdmission;
	env?: OpsAppEnv;
	openObserve?: OpenObserveClient;
	overviewService?: OpsOverviewService;
	staticRoot?: string;
	store?: OpsStatusStore;
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
const OpsPathIdSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[A-Za-z0-9._:-]+$/);

export function createOpsApp(options: OpsAppOptions = {}) {
	const app = new Hono();
	const env = options.env ?? process.env;
	const admission = options.admission ?? createCloudflareAccessOpsAdmission(env);
	const staticRoot = options.staticRoot ?? "dist";
	const store = options.store ?? createDefaultOpsStatusStore(env);
	const openObserve = options.openObserve ?? createDefaultOpenObserveClient(env);
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
				openObserve,
			}),
			store,
		});

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
			strictTransportSecurity: false,
			xFrameOptions: "DENY",
		}),
	);

	app.onError((error) => {
		console.error("[ops-web] unhandled api error", error);
		if (error instanceof OpenObserveUnavailableError) {
			return jsonError("OPS_OBSERVABILITY_UNAVAILABLE", "OpenObserve 数据不可用。", 503);
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
			await openObserve.queryRequest({
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

function createDefaultOpenObserveClient(env: OpenObserveEnv): OpenObserveClient {
	try {
		return createOpenObserveClientFromEnv(env);
	} catch (error) {
		const unavailable = async (): Promise<never> => {
			throw error instanceof OpenObserveUnavailableError
				? error
				: new OpenObserveUnavailableError("OpenObserve client is unavailable.", { cause: error });
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

function jsonError(
	code: string,
	message: string,
	status: 400 | 403 | 404 | 500 | 503 = 404,
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

function isStaticAssetPath(path: string) {
	return /\.[A-Za-z0-9]+$/.test(path.split("/").at(-1) ?? "");
}
