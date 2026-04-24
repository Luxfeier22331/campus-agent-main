import { describe, expect, it } from "vitest";

describe("audit domain helpers", () => {
	it("formats lifecycle and governance event types with explicit chinese labels", async () => {
		const { formatAuditEventType } = await import("../src/panel/pages/audit-domain");

		expect(formatAuditEventType("request.accepted")).toBe("请求已受理");
		expect(formatAuditEventType("request.completed")).toBe("请求已完成");
		expect(formatAuditEventType("request.needs_clarification")).toBe("请求待澄清");
		expect(formatAuditEventType("authz.decision")).toBe("授权决策");
		expect(formatAuditEventType("operator.action")).toBe("运维操作");
		expect(formatAuditEventType("execution.admission_rejected")).toBe("执行准入拒绝");
		expect(formatAuditEventType("execution.cancel_requested")).toBe("执行取消已请求");
		expect(formatAuditEventType("execution.cancelled")).toBe("执行已取消");
		expect(formatAuditEventType("execution.bridge_failed")).toBe("执行桥接失败");
		expect(formatAuditEventType("execution.timed_out")).toBe("执行超时");
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
				bridgeDurationMs: 35_000,
				decision: "queue_full",
				durationMs: 35_012,
				failClosed: true,
				failureKind: "timeout",
				httpStatus: 504,
				lane: "rag",
				queueWaitMs: 12,
				retryable: true,
				sourceDocIds: ["handbook:library-hours", "handbook:holiday-hours"],
			}),
		).toEqual([
			{ label: "Fail Closed", value: "是" },
			{ label: "ACL 异常", value: "projection_missing" },
			{ label: "执行通道", value: "rag" },
			{ label: "执行决策", value: "queue_full" },
			{ label: "失败类型", value: "timeout" },
			{ label: "HTTP 状态", value: "504" },
			{ label: "可重试", value: "是" },
			{ label: "排队等待", value: "12 ms" },
			{ label: "桥接耗时", value: "35000 ms" },
			{ label: "总耗时", value: "35012 ms" },
			{ label: "来源文档", value: "handbook:library-hours · handbook:holiday-hours" },
		]);
	});
});
