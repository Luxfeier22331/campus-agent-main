import { TransportDateSchema, transportDateRange } from "@campus-agent/transport/domain";
import type { Hono } from "hono";
import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse, routeErrorResponse } from "../../http";
import type { AppRequestScope } from "../types";

const DateSchema = TransportDateSchema;

export function registerTransportRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
}) {
	input.app.get("/api/transport/schedule", async (c) => {
		const date = DateSchema.safeParse(c.req.query("date"));
		if (!date.success) {
			return routeErrorResponse(
				new AppApiRouteError({
					code: "transport_date_invalid",
					message: "日期必须为 YYYY-MM-DD。",
					retryable: false,
					status: 400,
				}),
			);
		}
		try {
			return jsonResponse(
				await input.createRequestScope().resolveTransportScheduleService().getSchedule(date.data),
				{
					headers: { "cache-control": "public, max-age=30, s-maxage=60" },
				},
			);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	});
	input.app.get("/api/transport/schedule-range", async (c) => {
		const from = c.req.query("from") ?? "";
		const to = c.req.query("to") ?? "";
		try {
			transportDateRange(from, to);
		} catch {
			return routeErrorResponse(
				new AppApiRouteError({
					code: "transport_range_invalid",
					message: "请选择 1 至 31 天的有效日期范围。",
					retryable: false,
					status: 400,
				}),
			);
		}
		try {
			return jsonResponse(
				await input.createRequestScope().resolveTransportScheduleService().getRange(from, to),
				{ headers: { "cache-control": "public, max-age=30, s-maxage=60" } },
			);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	});
}
