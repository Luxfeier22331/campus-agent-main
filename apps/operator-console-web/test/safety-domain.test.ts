import { describe, expect, it } from "vitest";

describe("safety domain helpers", () => {
	it("builds chinese decision-distribution entries for safety summary cards", async () => {
		const { buildSafetyDecisionDistributionEntries } = await import(
			"../src/panel/pages/safety-domain"
		);

		expect(
			buildSafetyDecisionDistributionEntries({
				allowed: 84,
				approvalRequired: 5,
				denied: 7,
				failClosed: 4,
			}),
		).toEqual([
			{ count: 84, key: "allowed", label: "允许" },
			{ count: 5, key: "approvalRequired", label: "待审批" },
			{ count: 7, key: "denied", label: "拒绝" },
			{ count: 4, key: "failClosed", label: "Fail Closed" },
		]);
	});

	it("formats anomaly severity, status, and codes with explicit chinese labels", async () => {
		const { formatSafetyAnomalyCode, formatSafetyAnomalySeverity, formatSafetyAnomalyStatus } =
			await import("../src/panel/pages/safety-domain");

		expect(formatSafetyAnomalySeverity("high")).toBe("高风险");
		expect(formatSafetyAnomalySeverity("medium")).toBe("中风险");
		expect(formatSafetyAnomalyStatus("open")).toBe("待处理");
		expect(formatSafetyAnomalyCode("projection_missing")).toBe("同步缺失");
		expect(formatSafetyAnomalyCode("projection_conflict")).toBe("同步冲突");
		expect(formatSafetyAnomalyCode("fail_open_suspected")).toBe("疑似 Fail Open");
		expect(formatSafetyAnomalyCode("custom_acl_code")).toBe("custom_acl_code");
	});

	it("summarizes fail-close, restricted deny, and acl anomaly posture for operators", async () => {
		const { buildSafetyPostureEntries } = await import("../src/panel/pages/safety-domain");

		expect(
			buildSafetyPostureEntries({
				aclAnomalyRate: {
					count: 2,
					eligibleCount: 100,
					value: 0.02,
				},
				decisionDistribution: {
					allowed: 84,
					approvalRequired: 5,
					denied: 7,
					failClosed: 4,
				},
				failClosedRate: {
					count: 4,
					eligibleCount: 100,
					value: 0.04,
				},
				restrictedDenyRate: {
					count: 7,
					eligibleCount: 100,
					value: 0.07,
				},
			}),
		).toEqual([
			{
				detail: "4 / 100",
				key: "failClosed",
				label: "Fail Closed",
				tone: "warning",
				value: "4.0%",
			},
			{
				detail: "7 / 100",
				key: "restrictedDeny",
				label: "Restricted Deny",
				tone: "info",
				value: "7.0%",
			},
			{
				detail: "2 / 100",
				key: "aclAnomaly",
				label: "ACL 异常",
				tone: "warning",
				value: "2.0%",
			},
		]);
	});
});
