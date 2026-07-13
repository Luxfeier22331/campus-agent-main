// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
	buildCampusServicesOpsService,
	createInMemoryCampusServicesOpsStore,
} from "../src/modules/campus-services-ops";
import { createCampusPrincipal, createOperatorPrincipal, env } from "./operator-route.test-support";

describe("campus services ops routes", () => {
	it("exposes operator-only attestation, override preview, publish, and audit endpoints", async () => {
		const service = buildCampusServicesOpsService({
			generateId: (prefix) => `${prefix}_route`,
			now: () => new Date("2026-06-11T08:00:00.000Z"),
			store: createInMemoryCampusServicesOpsStore(),
		});
		const app = createApp(env, {
			campusServicesOpsService: service,
			getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
		} as Parameters<typeof createApp>[1]);

		const attestationResponse = await app.fetch(
			new Request("https://app-api.internal/api/operator/campus-services/attestations", {
				body: JSON.stringify({
					confirmedAt: "2026-06-11T07:50:00.000Z",
					sourceType: "counselor_notice",
					summary: "导员确认医保窗口下午暂停办理。",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		const transportResponse = await app.fetch(
			new Request("https://app-api.internal/api/operator/campus-services/transport-overrides", {
				body: JSON.stringify({
					displayName: "海淀至丰台校车",
					effectiveFrom: "2026-06-11T07:00:00.000Z",
					effectiveUntil: "2026-06-11T10:00:00.000Z",
					message: "发车延迟 15 分钟。",
					routeId: "haidian_fengtai_shuttle",
					serviceStatus: "delayed",
					sourceAttestationIds: ["services_attestation_route"],
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		const previewResponse = await app.fetch(
			new Request("https://app-api.internal/api/operator/campus-services/releases/preview", {
				body: JSON.stringify({ notes: "人工校对后发布。" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		const publishResponse = await app.fetch(
			new Request("https://app-api.internal/api/operator/campus-services/releases", {
				body: JSON.stringify({ notes: "人工校对后发布。" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		const auditResponse = await app.fetch(
			new Request("https://app-api.internal/api/operator/campus-services/audit-events"),
		);

		expect(attestationResponse.status).toBe(200);
		expect(transportResponse.status).toBe(200);
		expect(previewResponse.status).toBe(200);
		expect(publishResponse.status).toBe(200);
		expect(auditResponse.status).toBe(200);
		await expect(previewResponse.json()).resolves.toMatchObject({
			preview: {
				currentEffective: {
					transportOverrides: [expect.objectContaining({ routeId: "haidian_fengtai_shuttle" })],
				},
				warnings: [],
			},
		});
		await expect(publishResponse.json()).resolves.toMatchObject({
			currentEffective: {
				transportOverrides: [expect.objectContaining({ routeId: "haidian_fengtai_shuttle" })],
			},
			release: expect.objectContaining({
				itemCount: 1,
				status: "published",
			}),
		});
		await expect(auditResponse.json()).resolves.toMatchObject({
			auditEvents: expect.arrayContaining([
				expect.objectContaining({ action: "release.published" }),
			]),
		});
	});

	it("rejects non-operator campus-services ops access", async () => {
		const app = createApp(env, {
			campusServicesOpsService: buildCampusServicesOpsService({
				store: createInMemoryCampusServicesOpsStore(),
			}),
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		} as Parameters<typeof createApp>[1]);

		const response = await app.fetch(
			new Request("https://app-api.internal/api/operator/campus-services/releases"),
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "forbidden",
			},
		});
	});

	it("returns validation_failed for invalid transport override effective windows", async () => {
		const app = createApp(env, {
			campusServicesOpsService: buildCampusServicesOpsService({
				store: createInMemoryCampusServicesOpsStore(),
			}),
			getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
		} as Parameters<typeof createApp>[1]);

		const response = await app.fetch(
			new Request("https://app-api.internal/api/operator/campus-services/transport-overrides", {
				body: JSON.stringify({
					displayName: "海淀至丰台校车",
					effectiveFrom: "2026-06-11T10:00:00.000Z",
					effectiveUntil: "2026-06-11T07:00:00.000Z",
					message: "发车延迟 15 分钟。",
					routeId: "haidian_fengtai_shuttle",
					serviceStatus: "delayed",
					sourceAttestationIds: [],
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(422);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "validation_failed",
			},
		});
	});
});
