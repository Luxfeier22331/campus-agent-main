import type { Hono } from "hono";
import { z } from "zod";
import {
	OpsOverviewResponseSchema,
	OpsOverviewWindowSchema,
	OpsRequestDetailResponseSchema,
	OpsRequestListResponseSchema,
	OpsRequestListViewSchema,
	OpsRequestWindowSchema,
	OpsSentryIssuesResponseSchema,
} from "../../shared/ops-contract.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import type { OpsOverviewService } from "../ops-overview-service.ts";
import { decodeRequestCursor } from "../ops-status-mappers.ts";
import type { OpsStatusStore } from "../ops-status-types.ts";
import type { SentryClient } from "../sentry-client.ts";
import { admitOpsApiRequest, jsonError, OpsPathIdSchema } from "./http.ts";

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
export function registerOverviewRoute(input: {
	admission: OpsAdmission;
	app: Hono;
	overviewService: OpsOverviewService;
}): void {
	const { admission, app, overviewService } = input;
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
}

export function registerObservabilityRoutes(input: {
	admission: OpsAdmission;
	app: Hono;
	sentry: SentryClient;
	store: OpsStatusStore;
}): void {
	const { admission, app, sentry, store } = input;
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
}
