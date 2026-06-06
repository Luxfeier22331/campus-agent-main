// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { OfficialWebTargetInventoryService } from "../src/modules/official-web-target-inventory";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://hub.muc.wiki",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
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
						admissionTargetId: "campus-services-service-guide",
						consumerFamily: "service_guide_candidate",
						fieldStatus: {
							process_steps: "missing",
						},
						id: "muc-information-disclosure-application-process",
						inventoryId: "muc-information-disclosure-application-process",
						ownerSurface: "service_guide_lookup",
						optionalEvidence: ["service_material"],
						optionalFields: ["required_materials"],
						previewEvidence: null,
						releaseBlockers: ["no_preview_evidence"],
						requiredEvidence: ["service_process"],
						requiredFields: ["process_steps"],
						reviewState: "candidate",
						selectedWriteTarget: "campus_services/service_guide",
						sourceUrls: ["https://xxgk.muc.edu.cn/info/1007/1113.htm"],
						targetLabel: "中央民族大学信息公开依申请公开工作流程",
					},
				],
				page: { nextCursor: null },
				summary: {
					countsByReviewState: { candidate: 1 },
					inventoryVersion: "muc_public_target_inventory_v1",
					siteId: "muc_public",
				},
			}),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(principal),
			officialWebTargetInventoryService: service,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/official-web/target-inventory?siteId=muc_public",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			entries: [
				expect.objectContaining({
					id: "muc-information-disclosure-application-process",
					releaseBlockers: ["no_preview_evidence"],
					reviewState: "candidate",
				}),
			],
			page: { nextCursor: null },
			summary: {
				countsByReviewState: { candidate: 1 },
				inventoryVersion: "muc_public_target_inventory_v1",
				siteId: "muc_public",
			},
		});
		expect(service.listTargetInventory).toHaveBeenCalledWith({
			filters: {
				consumerFamily: null,
				ownerSurface: null,
				reviewState: null,
				siteId: "muc_public",
			},
			principal,
		});
	});
});
