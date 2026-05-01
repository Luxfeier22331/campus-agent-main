// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import { buildOfficialWebTargetInventoryService } from "../src/modules/official-web-target-inventory";

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

describe("official web target inventory service", () => {
	it("builds the operator projection from the canonical inventory manifest", async () => {
		const service = buildOfficialWebTargetInventoryService({
			targetInventory: {
				entries: [
					{
						admissionTargetId: "campus-services-service-guide",
						consumerFamily: "service_guide_candidate",
						inventoryId: "test-service-guide",
						inventoryOnly: false,
						materializationPolicy: "candidate_only",
						notes: "Test inventory row.",
						ownerAgentOrRuntime: "campus-services-agent",
						ownerSurface: "service_guide_lookup",
						previewStatus: "candidate",
						releaseBlockers: ["no_preview_evidence"],
						requiredEvidence: ["service_process"],
						requiredFields: ["service_name", "source_url"],
						selectedWriteTarget: "campus_services/service_guide",
						sourceHosts: ["xxgk.muc.edu.cn"],
						sourceUrls: ["https://xxgk.muc.edu.cn/info/1007/1113.htm"],
						targetLabel: "测试服务指南",
					},
				],
				inventoryVersion: "test_inventory_v1",
				schemaVersion: "official_web_target_inventory.v1",
				siteId: "muc_public",
			},
		});

		const result = await service.listTargetInventory({
			filters: {
				consumerFamily: null,
				ownerSurface: "service_guide_lookup",
				reviewState: null,
				siteId: "muc_public",
			},
			principal: createOperatorPrincipal(),
		});

		expect(result).toMatchObject({
			entries: [
				{
					id: "test-service-guide",
					inventoryId: "test-service-guide",
					fieldStatus: {
						service_name: "missing",
						source_url: "missing",
					},
					releaseBlockers: ["no_preview_evidence"],
					reviewState: "candidate",
				},
			],
			summary: {
				countsByReviewState: { candidate: 1 },
				inventoryVersion: "test_inventory_v1",
				siteId: "muc_public",
			},
		});
	});
});
