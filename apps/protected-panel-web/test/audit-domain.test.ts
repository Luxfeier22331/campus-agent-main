import { describe, expect, it } from "vitest";

describe("audit domain helpers", () => {
	it("formats lifecycle and governance event types with explicit chinese labels", async () => {
		const { formatAuditEventType } = await import("../src/panel/pages/audit-domain");

		expect(formatAuditEventType("request.accepted")).toBe("请求已受理");
		expect(formatAuditEventType("request.completed")).toBe("请求已完成");
		expect(formatAuditEventType("request.needs_clarification")).toBe("请求待澄清");
		expect(formatAuditEventType("authz.decision")).toBe("授权决策");
		expect(formatAuditEventType("operator.action")).toBe("运维操作");
		expect(formatAuditEventType("custom.event")).toBe("custom.event");
	});

	it("formats audit statuses with chinese labels and safe fallbacks", async () => {
		const { formatAuditStatus } = await import("../src/panel/pages/audit-domain");

		expect(formatAuditStatus("accepted")).toBe("已受理");
		expect(formatAuditStatus("completed")).toBe("已完成");
		expect(formatAuditStatus("needs_clarification")).toBe("待澄清");
		expect(formatAuditStatus("approval_required")).toBe("待审批");
		expect(formatAuditStatus("rejected")).toBe("已拒绝");
		expect(formatAuditStatus("allowed")).toBe("允许");
		expect(formatAuditStatus("denied")).toBe("拒绝");
		expect(formatAuditStatus("open")).toBe("待处理");
		expect(formatAuditStatus("custom_status")).toBe("custom_status");
	});

	it("builds governance-safe diagnostic entries for the detail drawer", async () => {
		const { buildAuditDiagnosticEntries } = await import("../src/panel/pages/audit-domain");

		expect(
			buildAuditDiagnosticEntries({
				aclAnomalyCode: "projection_missing",
				failClosed: true,
				sourceDocIds: ["handbook:library-hours", "handbook:holiday-hours"],
			}),
		).toEqual([
			{ label: "Fail Closed", value: "是" },
			{ label: "ACL 异常", value: "projection_missing" },
			{ label: "来源文档", value: "handbook:library-hours · handbook:holiday-hours" },
		]);
	});
});
