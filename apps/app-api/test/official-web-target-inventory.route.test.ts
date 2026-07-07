// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { OfficialWebTargetInventoryService } from "../src/modules/official-web-target-inventory";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
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

describe("official web target inventory operator route", () => {
	it("lists target inventory through app-api without object-store access", async () => {
		const principal = createOperatorPrincipal();
		const service: OfficialWebTargetInventoryService = {
			getTargetInventoryEntryById: vi.fn(),
			listTargetInventory: vi.fn().mockResolvedValue({
				entries: [
					{
						admissionTargetId: "official-web-institutional-rules",
						consumerFamily: "regulation_candidate",
						fieldStatus: {
							reference_title: "missing",
						},
						id: "muc-public-regulation",
						inventoryId: "muc-public-regulation",
						ownerSurface: "regulations/institutional_rules",
						optionalEvidence: [],
						optionalFields: [],
						previewEvidence: null,
						releaseBlockers: ["no_preview_evidence", "release_gate_not_reviewed"],
						requiredEvidence: ["regulation_text"],
						requiredFields: ["reference_title"],
						reviewState: "candidate",
						selectedWriteTarget: "regulations/institutional_rules",
						sourceUrls: ["https://info.example.edu/info/1198/4101.htm"],
						targetLabel: "示例大学学术委员会章程",
					},
				],
				page: { nextCursor: null },
				summary: {
					countsByReviewState: { candidate: 1 },
					inventoryVersion: "example_public_target_inventory_v1",
					siteId: "example_public",
				},
			}),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal),
			officialWebTargetInventoryService: service,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/official-web/target-inventory?siteId=example_public",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			entries: [
				expect.objectContaining({
					id: "muc-public-regulation",
					releaseBlockers: ["no_preview_evidence", "release_gate_not_reviewed"],
					reviewState: "candidate",
				}),
			],
			page: { nextCursor: null },
			summary: {
				countsByReviewState: { candidate: 1 },
				inventoryVersion: "example_public_target_inventory_v1",
				siteId: "example_public",
			},
		});
		expect(service.listTargetInventory).toHaveBeenCalledWith({
			filters: {
				consumerFamily: null,
				ownerSurface: null,
				reviewState: null,
				siteId: "example_public",
			},
			principal,
		});
	});
});
