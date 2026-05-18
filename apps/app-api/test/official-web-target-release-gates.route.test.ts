// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { OfficialWebTargetReleaseGateService } from "../src/modules/official-web-target-release-gates";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://hub.muc.wiki",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
	SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
	SUPERVISOR_API_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function createOperatorPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: ["ops"],
			principalId: "ops@example.com",
			principalType: "operator",
			roles: ["operator"],
			userId: "ops@example.com",
		},
		permissions: {
			chat: false,
			operator: true,
		},
		principal: {
			displayName: "Ops Team",
			email: "ops@example.com",
			principalId: "ops@example.com",
			type: "operator",
		},
		session: null,
	};
}

describe("official web target release gate routes", () => {
	it("lets an operator approve a stable reference release gate", async () => {
		const principal = createOperatorPrincipal();
		const service: OfficialWebTargetReleaseGateService = {
			createReleaseGate: vi.fn().mockResolvedValue({
				releaseGate: {
					decidedAt: "2026-05-01T08:00:00.000Z",
					decidedBy: "ops@example.com",
					decision: "approved",
					inventoryId: "muc-school-introduction-reference",
					jobId: "owtarget_school_intro",
					publishAlias: false,
					releaseId: "owrelease_muc_school_introduction_reference_owrun_school_intro",
					runId: "owrun_school_intro",
					status: "approved",
				},
			}),
			getReleaseGateById: vi.fn(),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal),
			officialWebTargetReleaseGateService: service,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/official-web/target-inventory/muc-school-introduction-reference/release-gates",
				{
					body: JSON.stringify({
						decision: "approved",
						notes: "reviewed",
					}),
					headers: {
						"content-type": "application/json",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			releaseGate: expect.objectContaining({
				publishAlias: false,
				releaseId: "owrelease_muc_school_introduction_reference_owrun_school_intro",
				status: "approved",
			}),
		});
		expect(service.createReleaseGate).toHaveBeenCalledWith({
			inventoryId: "muc-school-introduction-reference",
			payload: {
				decision: "approved",
				notes: "reviewed",
			},
			principal,
		});
	});

	it("does not expose release gate executor status callbacks from app-api", async () => {
		const service: OfficialWebTargetReleaseGateService = {
			createReleaseGate: vi.fn(),
			getReleaseGateById: vi.fn().mockResolvedValue({
				releaseGate: {
					releaseId: "owrelease_muc_school_introduction_reference_owrun_school_intro",
					status: "approved",
				},
			}),
		};
		const app = createApp(env, {
			officialWebTargetReleaseGateService: service,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/official-web/target-release-gates/owrelease_muc_school_introduction_reference_owrun_school_intro/execution-status",
				{
					body: JSON.stringify({
						execution: { indexName: "official_web_stable_reference__r20260501_081000" },
						status: "indexed",
						updatedAt: "2026-05-01T08:11:00.000Z",
					}),
					headers: {
						"content-type": "application/json",
						"x-app-internal-auth": "app-api-internal-secret",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(404);
	});

	it("does not expose release gate executor read routes from app-api", async () => {
		const service: OfficialWebTargetReleaseGateService = {
			createReleaseGate: vi.fn(),
			getReleaseGateById: vi.fn(),
		};
		const app = createApp(env, {
			officialWebTargetReleaseGateService: service,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/official-web/target-release-gates/owrelease_muc_school_introduction_reference_owrun_school_intro",
				{
					headers: {
						"x-app-internal-auth": "app-api-internal-secret",
					},
				},
			),
		);

		expect(response.status).toBe(404);
	});

	it("does not treat removed release executor callback as an auth-gated app-api surface", async () => {
		const service: OfficialWebTargetReleaseGateService = {
			createReleaseGate: vi.fn(),
			getReleaseGateById: vi.fn(),
		};
		const app = createApp(env, {
			officialWebTargetReleaseGateService: service,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/official-web/target-release-gates/owrelease_muc_school_introduction_reference_owrun_school_intro/execution-status",
				{
					body: JSON.stringify({
						status: "failed",
						updatedAt: "2026-05-01T08:11:00.000Z",
					}),
					headers: {
						"content-type": "application/json",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(404);
	});
});
