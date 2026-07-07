import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse, routeErrorResponse } from "../../http";
import { parseFeedbackCategory, type SubmitFeedbackInput } from "../../modules/campus-experience";
import { readJsonRequestBody } from "../request-utils";
import type { AppRequestScope } from "../types";

export function registerCampusExperienceRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
}) {
	input.app.get("/api/campus-map/places", async () => {
		const scope = input.createRequestScope();
		return jsonResponse(await scope.resolveCampusExperienceService().getMapPlaces());
	});

	input.app.get("/api/campus-map/places/:placeId", async (c) => {
		const scope = input.createRequestScope();
		try {
			return jsonResponse(
				await scope.resolveCampusExperienceService().getMapPlace({
					placeId: c.req.param("placeId"),
				}),
			);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	});

	input.app.get("/api/campus-services/transport-schedule/status", async () => {
		const scope = input.createRequestScope();
		try {
			const result = await scope.resolveCampusServicesTransportScheduleService().getPublicStatus();
			return jsonResponse(result.projection, {
				headers: {
					"cache-control": "public, max-age=60, s-maxage=300",
					...(result.etag ? { etag: result.etag } : {}),
				},
			});
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	});

	input.app.get("/api/dining/halls", async () => {
		const scope = input.createRequestScope();
		return jsonResponse(await scope.resolveDiningOperationsService().getPublishedHalls());
	});

	input.app.get("/api/dining/halls/:hallId/floors/:floorId", async (c) => {
		const scope = input.createRequestScope();
		try {
			return jsonResponse(
				await scope.resolveDiningOperationsService().getPublishedFloor({
					floorId: c.req.param("floorId"),
					hallId: c.req.param("hallId"),
				}),
			);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	});

	input.app.get("/api/dining/halls/:hallId/reviews", async (c) => {
		const scope = input.createRequestScope();
		try {
			return jsonResponse(
				await scope.resolveDiningOperationsService().getPublishedHallReviews({
					hallId: c.req.param("hallId"),
				}),
			);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponse(error);
			}
			throw error;
		}
	});

	input.app.post("/api/feedback", async (c) => {
		const scope = input.createRequestScope();
		const body = await readJsonRequestBody(c.req.raw);
		return jsonResponse(
			await scope.resolveCampusExperienceService().submitFeedback(parseFeedbackRequestBody(body)),
			{ status: 201 },
		);
	});
}

function parseFeedbackRequestBody(body: unknown): SubmitFeedbackInput {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			message: "Feedback request body must be an object.",
			retryable: false,
			status: 400,
		});
	}

	const record = body as Record<string, unknown>;
	return {
		body: requireString(record.body, "body"),
		category: parseFeedbackCategory(record.category),
		contact: optionalString(record.contact),
		routeContext: requireString(record.routeContext, "routeContext"),
	};
}

function requireString(value: unknown, field: string): string {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	throw new AppApiRouteError({
		code: "validation_failed",
		details: { field },
		message: `${field} is required.`,
		retryable: false,
		status: 400,
	});
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
