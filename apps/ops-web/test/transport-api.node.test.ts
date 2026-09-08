// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import type {
	TransportOpsRoute,
	TransportOpsSchedulePeriod,
	TransportStore,
} from "../src/server/transport-store-contract";
import {
	TransportStoreConflictError,
	TransportStoreNotFoundError,
	TransportStoreUnavailableError,
} from "../src/server/transport-store-errors";
import { createTestOpsApp } from "./helpers/ops-app";

const NOW = "2026-09-07T08:00:00.000Z";
const PUBLIC_ORIGIN = "https://ops.example.test";
const writeHeaders = { "content-type": "application/json", origin: PUBLIC_ORIGIN };

const route: TransportOpsRoute = {
	createdAt: NOW,
	defaultBoardingPoint: "丰台校区南门",
	destination: "海淀校区",
	displayOrder: 0,
	origin: "丰台校区",
	routeId: "route:fengtai-haidian",
	serviceKind: "commute",
	updatedAt: NOW,
	updatedBy: "ops@example.test",
};

const period: TransportOpsSchedulePeriod = {
	boardingPointOverride: null,
	createdAt: NOW,
	items: [
		{
			boardingPoint: null,
			capacity: null,
			departureTime: "07:30",
			itemId: "schedule:1:0",
			kind: "fixed",
			note: null,
			riderType: "all",
			sortOrder: 0,
		},
	],
	note: null,
	routeId: route.routeId,
	scheduleId: "schedule:1",
	status: "operating",
	updatedAt: NOW,
	updatedBy: "ops@example.test",
	validFrom: "2026-08-31",
	validTo: null,
	weekdays: [1, 2, 3, 4, 5],
};

function transportStore(): TransportStore {
	return {
		createRoute: vi.fn(async () => route),
		createSchedulePeriod: vi.fn(async () => period),
		deleteRoute: vi.fn(async () => undefined),
		deleteSchedulePeriod: vi.fn(async () => undefined),
		listRoutes: vi.fn(async () => [route]),
		listSchedulePeriods: vi.fn(async () => [period]),
		updateRoute: vi.fn(async () => route),
		updateSchedulePeriod: vi.fn(async () => period),
	};
}

function createTransportApp(store: TransportStore) {
	return createTestOpsApp({
		admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
		env: { OPS_WEB_PUBLIC_ORIGIN: PUBLIC_ORIGIN },
		transportStore: store,
	});
}

describe("Ops Web transport API", () => {
	it("lists routes, complete schedule periods", async () => {
		const store = transportStore();
		const app = createTransportApp(store);
		const responses = await Promise.all([
			app.request("/api/ops/transport/routes"),
			app.request("/api/ops/transport/schedule-periods"),
		]);

		expect(responses.map((response) => response.status)).toEqual([200, 200]);
		await expect(responses[0]?.json()).resolves.toEqual({ routes: [route] });
		await expect(responses[1]?.json()).resolves.toEqual({ schedulePeriods: [period] });
	});

	it("creates, updates and deletes the new resources", async () => {
		const store = transportStore();
		const app = createTransportApp(store);
		const routeInput = {
			defaultBoardingPoint: route.defaultBoardingPoint,
			destination: route.destination,
			displayOrder: route.displayOrder,
			origin: route.origin,
			routeId: route.routeId,
			serviceKind: route.serviceKind,
		};
		const periodInput = {
			boardingPointOverride: null,
			items: [
				{
					boardingPoint: null,
					capacity: null,
					departureTime: "07:30",
					kind: "fixed" as const,
					note: null,
					riderType: "all" as const,
					sortOrder: 0,
				},
			],
			note: null,
			routeId: route.routeId,
			status: "operating" as const,
			validFrom: "2026-08-31",
			validTo: null,
			weekdays: [1, 2, 3, 4, 5],
		};

		const responses = await Promise.all([
			app.request("/api/ops/transport/routes", {
				body: JSON.stringify(routeInput),
				headers: writeHeaders,
				method: "POST",
			}),
			app.request(`/api/ops/transport/routes/${route.routeId}`, {
				body: JSON.stringify({ displayOrder: 1 }),
				headers: writeHeaders,
				method: "PATCH",
			}),
			app.request(`/api/ops/transport/routes/${route.routeId}`, {
				headers: { origin: PUBLIC_ORIGIN },
				method: "DELETE",
			}),
			app.request("/api/ops/transport/schedule-periods", {
				body: JSON.stringify(periodInput),
				headers: writeHeaders,
				method: "POST",
			}),
			app.request(`/api/ops/transport/schedule-periods/${period.scheduleId}`, {
				body: JSON.stringify(periodInput),
				headers: writeHeaders,
				method: "PATCH",
			}),
			app.request(`/api/ops/transport/schedule-periods/${period.scheduleId}`, {
				headers: { origin: PUBLIC_ORIGIN },
				method: "DELETE",
			}),
		]);

		expect(responses.map((response) => response.status)).toEqual([201, 200, 204, 201, 200, 204]);
		expect(store.createSchedulePeriod).toHaveBeenCalledWith(
			expect.objectContaining({ principalId: "ops@example.test" }),
			periodInput,
		);
		expect(store.updateSchedulePeriod).toHaveBeenCalledWith(
			expect.any(Object),
			period.scheduleId,
			periodInput,
		);
	});

	it("requires the configured origin and rejects invalid writes", async () => {
		const store = transportStore();
		const app = createTransportApp(store);
		const crossOrigin = await app.request("/api/ops/transport/routes", {
			body: JSON.stringify({ routeId: "route:other" }),
			headers: { ...writeHeaders, origin: "https://other.example.test" },
			method: "POST",
		});
		const invalid = await app.request("/api/ops/transport/routes", {
			body: JSON.stringify({ routeId: "route:other" }),
			headers: writeHeaders,
			method: "POST",
		});

		expect(crossOrigin.status).toBe(403);
		expect(invalid.status).toBe(400);
		expect(store.createRoute).not.toHaveBeenCalled();
	});

	it("maps transport store failures to stable API errors", async () => {
		const unavailableStore = transportStore();
		vi.mocked(unavailableStore.listRoutes).mockRejectedValueOnce(
			new TransportStoreUnavailableError(),
		);
		const conflictStore = transportStore();
		vi.mocked(conflictStore.createRoute).mockRejectedValueOnce(
			new TransportStoreConflictError("线路已存在。"),
		);
		const missingStore = transportStore();
		vi.mocked(missingStore.deleteRoute).mockRejectedValueOnce(
			new TransportStoreNotFoundError("线路不存在。"),
		);

		const unavailable = await createTransportApp(unavailableStore).request(
			"/api/ops/transport/routes",
		);
		const conflict = await createTransportApp(conflictStore).request("/api/ops/transport/routes", {
			body: JSON.stringify({
				...route,
				createdAt: undefined,
				updatedAt: undefined,
				updatedBy: undefined,
			}),
			headers: writeHeaders,
			method: "POST",
		});
		const missing = await createTransportApp(missingStore).request(
			`/api/ops/transport/routes/${route.routeId}`,
			{ headers: { origin: PUBLIC_ORIGIN }, method: "DELETE" },
		);

		expect([unavailable.status, conflict.status, missing.status]).toEqual([503, 409, 404]);
	});
});
