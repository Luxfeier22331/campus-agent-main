import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse } from "../../http";
import type { DiningSaleStatus, DiningWindowStatus } from "../../modules/dining-ops";
import { requireOperatorPrincipal } from "../principal";
import { readJsonRequestBody } from "../request-utils";
import type { AppRequestScope } from "../types";

export function registerDiningOpsRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: Parameters<typeof requireOperatorPrincipal>[0]["getPrincipal"];
}) {
	input.app.get("/api/ops/dining/halls", async (c) => {
		const authorized = await requireDiningOperator(c.req.raw, input);
		if (authorized.response) {
			return authorized.response;
		}
		return jsonResponse(await authorized.scope.resolveDiningOperationsService().listHalls());
	});

	input.app.get("/api/ops/dining/halls/:hallId/floors/:floorId", async (c) => {
		const authorized = await requireDiningOperator(c.req.raw, input);
		if (authorized.response) {
			return authorized.response;
		}
		return jsonResponse(
			await authorized.scope.resolveDiningOperationsService().getFloor({
				floorId: c.req.param("floorId"),
				hallId: c.req.param("hallId"),
			}),
		);
	});

	input.app.patch("/api/ops/dining/windows/:windowId", async (c) => {
		const authorized = await requireDiningOperator(c.req.raw, input);
		if (authorized.response) {
			return authorized.response;
		}
		const body = parseWindowPatchBody(await readJsonRequestBody(c.req.raw));
		return jsonResponse(
			await authorized.scope.resolveDiningOperationsService().updateWindow({
				actor: authorized.actor,
				input: body,
				windowId: c.req.param("windowId"),
			}),
		);
	});

	input.app.post("/api/ops/dining/window-assignments", async (c) => {
		const authorized = await requireDiningOperator(c.req.raw, input);
		if (authorized.response) {
			return authorized.response;
		}
		const body = parseWindowAssignmentBody(await readJsonRequestBody(c.req.raw));
		return jsonResponse(
			await authorized.scope.resolveDiningOperationsService().assignWindow({
				actor: authorized.actor,
				input: body,
			}),
			{ status: 201 },
		);
	});

	input.app.patch("/api/ops/dining/window-assignments/:assignmentId", async (c) => {
		const authorized = await requireDiningOperator(c.req.raw, input);
		if (authorized.response) {
			return authorized.response;
		}
		const body = parseWindowAssignmentPatchBody(await readJsonRequestBody(c.req.raw));
		return jsonResponse(
			await authorized.scope.resolveDiningOperationsService().updateWindowAssignment({
				actor: authorized.actor,
				assignmentId: c.req.param("assignmentId"),
				input: body,
			}),
		);
	});

	input.app.post("/api/ops/dining/menu-items", async (c) => {
		const authorized = await requireDiningOperator(c.req.raw, input);
		if (authorized.response) {
			return authorized.response;
		}
		const body = parseMenuItemCreateBody(await readJsonRequestBody(c.req.raw));
		return jsonResponse(
			await authorized.scope.resolveDiningOperationsService().createMenuItem({
				actor: authorized.actor,
				input: body,
			}),
			{ status: 201 },
		);
	});

	input.app.patch("/api/ops/dining/menu-items/:menuItemId", async (c) => {
		const authorized = await requireDiningOperator(c.req.raw, input);
		if (authorized.response) {
			return authorized.response;
		}
		const body = parseMenuItemPatchBody(await readJsonRequestBody(c.req.raw));
		return jsonResponse(
			await authorized.scope.resolveDiningOperationsService().updateMenuItem({
				actor: authorized.actor,
				input: body,
				menuItemId: c.req.param("menuItemId"),
			}),
		);
	});

	input.app.post("/api/ops/dining/menu-offerings", async (c) => {
		const authorized = await requireDiningOperator(c.req.raw, input);
		if (authorized.response) {
			return authorized.response;
		}
		const body = parseMenuOfferingCreateBody(await readJsonRequestBody(c.req.raw));
		return jsonResponse(
			await authorized.scope.resolveDiningOperationsService().createMenuOffering({
				actor: authorized.actor,
				input: body,
			}),
			{ status: 201 },
		);
	});

	input.app.patch("/api/ops/dining/menu-offerings/:offeringId", async (c) => {
		const authorized = await requireDiningOperator(c.req.raw, input);
		if (authorized.response) {
			return authorized.response;
		}
		const body = parseMenuOfferingPatchBody(await readJsonRequestBody(c.req.raw));
		return jsonResponse(
			await authorized.scope.resolveDiningOperationsService().updateMenuOffering({
				actor: authorized.actor,
				input: body,
				offeringId: c.req.param("offeringId"),
			}),
		);
	});

	input.app.get("/api/ops/dining/releases", async (c) => {
		const authorized = await requireDiningOperator(c.req.raw, input);
		if (authorized.response) {
			return authorized.response;
		}
		return jsonResponse(await authorized.scope.resolveDiningOperationsService().listReleases());
	});

	input.app.post("/api/ops/dining/releases", async (c) => {
		const authorized = await requireDiningOperator(c.req.raw, input);
		if (authorized.response) {
			return authorized.response;
		}
		const body = parseReleaseBody(await readJsonRequestBody(c.req.raw));
		return jsonResponse(
			await authorized.scope.resolveDiningOperationsService().publishRelease({
				actor: authorized.actor,
				input: body,
			}),
			{ status: 201 },
		);
	});

	input.app.get("/api/ops/dining/releases/:releaseId/preview", async (c) => {
		const authorized = await requireDiningOperator(c.req.raw, input);
		if (authorized.response) {
			return authorized.response;
		}
		return jsonResponse(
			await authorized.scope.resolveDiningOperationsService().previewRelease({
				actor: authorized.actor,
				input: { notes: `Preview ${c.req.param("releaseId")}` },
			}),
		);
	});

	input.app.post("/api/ops/dining/releases/:releaseId/publish", async (c) => {
		const authorized = await requireDiningOperator(c.req.raw, input);
		if (authorized.response) {
			return authorized.response;
		}
		const body = parseReleaseBody(await readJsonRequestBody(c.req.raw));
		return jsonResponse(
			await authorized.scope.resolveDiningOperationsService().publishRelease({
				actor: authorized.actor,
				input: body,
			}),
			{ status: 201 },
		);
	});

	input.app.get("/api/ops/dining/audit-events", async (c) => {
		const authorized = await requireDiningOperator(c.req.raw, input);
		if (authorized.response) {
			return authorized.response;
		}
		return jsonResponse(await authorized.scope.resolveDiningOperationsService().listAuditEvents());
	});
}

async function requireDiningOperator(
	request: Request,
	input: {
		createRequestScope: () => AppRequestScope;
		env: Env;
		getPrincipal: Parameters<typeof requireOperatorPrincipal>[0]["getPrincipal"];
	},
) {
	const scope = input.createRequestScope();
	const authorized = await requireOperatorPrincipal({
		env: input.env,
		getPrincipal: input.getPrincipal,
		request,
		scope,
	});
	if (authorized.response) {
		return { response: authorized.response };
	}
	return {
		actor: {
			displayName: authorized.principal.principal.displayName,
			principalId: authorized.principal.principal.principalId,
		},
		scope,
	};
}

function parseWindowAssignmentBody(body: unknown) {
	const record = requireRecord(body);
	const stallProfile = requireRecord(record.stallProfile);
	return {
		stallProfile: {
			displayName: requireString(stallProfile.displayName, "stallProfile.displayName"),
			stallType: requireString(stallProfile.stallType, "stallProfile.stallType"),
			tags: requireStringArray(stallProfile.tags, "stallProfile.tags"),
		},
		windowId: requireString(record.windowId, "windowId"),
	};
}

function parseWindowPatchBody(body: unknown) {
	const record = requireRecord(body);
	const parsed = {
		geometry: "geometry" in record ? parseGeometry(record.geometry, "geometry") : undefined,
		label: "label" in record ? requireString(record.label, "label") : undefined,
		locationLabel:
			"locationLabel" in record ? requireString(record.locationLabel, "locationLabel") : undefined,
		status: "status" in record ? requireWindowStatus(record.status) : undefined,
		tags: "tags" in record ? requireStringArray(record.tags, "tags") : undefined,
	};
	return requireNonEmptyPatch(parsed);
}

function parseWindowAssignmentPatchBody(body: unknown) {
	const record = requireRecord(body);
	const parsed = {
		stallProfile: "stallProfile" in record ? parseStallProfile(record.stallProfile) : undefined,
		status: "status" in record ? requireAssignmentStatus(record.status) : undefined,
	};
	return requireNonEmptyPatch(parsed);
}

function parseMenuItemCreateBody(body: unknown) {
	const record = requireRecord(body);
	return {
		name: requireString(record.name, "name"),
		tags: requireStringArray(record.tags, "tags"),
	};
}

function parseMenuItemPatchBody(body: unknown) {
	const record = requireRecord(body);
	const parsed = {
		name: "name" in record ? requireString(record.name, "name") : undefined,
		status: "status" in record ? requireMenuItemStatus(record.status) : undefined,
		tags: "tags" in record ? requireStringArray(record.tags, "tags") : undefined,
	};
	return requireNonEmptyPatch(parsed);
}

function parseMenuOfferingCreateBody(body: unknown) {
	const record = requireRecord(body);
	return {
		assignmentId: requireString(record.assignmentId, "assignmentId"),
		menuItemId: requireString(record.menuItemId, "menuItemId"),
		priceLabel: requireString(record.priceLabel, "priceLabel"),
		saleStatus: requireSaleStatus(record.saleStatus),
		specLabel: nullableString(record.specLabel, "specLabel"),
	};
}

function parseMenuOfferingPatchBody(body: unknown) {
	const record = requireRecord(body);
	const parsed = {
		priceLabel: "priceLabel" in record ? requireString(record.priceLabel, "priceLabel") : undefined,
		saleStatus: "saleStatus" in record ? requireSaleStatus(record.saleStatus) : undefined,
		specLabel: "specLabel" in record ? nullableString(record.specLabel, "specLabel") : undefined,
	};
	return requireNonEmptyPatch(parsed);
}

function parseStallProfile(value: unknown) {
	const stallProfile = requireRecord(value);
	return {
		displayName: requireString(stallProfile.displayName, "stallProfile.displayName"),
		stallType: requireString(stallProfile.stallType, "stallProfile.stallType"),
		tags: requireStringArray(stallProfile.tags, "stallProfile.tags"),
	};
}

function parseReleaseBody(body: unknown) {
	const record = requireRecord(body);
	return {
		notes: requireString(record.notes, "notes"),
	};
}

function requireRecord(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	throw validationError("body");
}

function requireString(value: unknown, field: string): string {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	throw validationError(field);
}

function nullableString(value: unknown, field: string): string | null {
	if (value === null) {
		return null;
	}
	return requireString(value, field);
}

function requireStringArray(value: unknown, field: string): string[] {
	if (Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim())) {
		return value.map((item) => item.trim());
	}
	throw validationError(field);
}

function requireWindowStatus(value: unknown): DiningWindowStatus {
	if (value === "active" || value === "closed" || value === "maintenance") {
		return value;
	}
	throw validationError("status");
}

function requireAssignmentStatus(value: unknown): "active" {
	if (value === "active") {
		return value;
	}
	throw validationError("status");
}

function requireMenuItemStatus(value: unknown): "active" {
	if (value === "active") {
		return value;
	}
	throw validationError("status");
}

function requireSaleStatus(value: unknown): DiningSaleStatus {
	if (value === "available" || value === "paused" || value === "seasonal" || value === "removed") {
		return value;
	}
	throw validationError("offering.saleStatus");
}

function parseGeometry(value: unknown, field: string) {
	const record = requireRecord(value);
	return {
		height: requireNumber(record.height, `${field}.height`),
		width: requireNumber(record.width, `${field}.width`),
		x: requireNumber(record.x, `${field}.x`),
		y: requireNumber(record.y, `${field}.y`),
	};
}

function requireNumber(value: unknown, field: string): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	throw validationError(field);
}

function requireNonEmptyPatch<T extends Record<string, unknown>>(input: T): Partial<T> {
	const patch = Object.fromEntries(
		Object.entries(input).filter(([, value]) => value !== undefined),
	) as Partial<T>;
	if (Object.keys(patch).length === 0) {
		throw validationError("body");
	}
	return patch;
}

function validationError(field: string): AppApiRouteError {
	return new AppApiRouteError({
		code: "validation_failed",
		details: { field },
		message: `${field} is invalid.`,
		retryable: false,
		status: 400,
	});
}
