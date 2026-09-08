import type { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse, routeErrorResponse } from "../../http";
import type { AppRequestScope } from "../types";

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "日期必须为 YYYY-MM-DD。");

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
}
