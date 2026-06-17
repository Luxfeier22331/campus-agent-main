import { PANEL_COPY } from "../panel-copy";

export function formatAuditEventType(value: string) {
	switch (value) {
		case "request.accepted":
			return "请求已受理";
		case "request.completed":
			return "请求已完成";
		case "request.needs_clarification":
			return "请求待澄清";
		case "request.approval_required":
			return "请求待审批";
		case "request.rejected":
			return "请求已拒绝";
		case "request.no_answer":
			return "请求无法回答";
		case "request.error":
			return "请求出错";
		case "authz.decision":
			return "授权决策";
		case "retrieval.summary":
			return "检索摘要";
		case "operator.action":
			return "运维操作";
		case "execution.admission_rejected":
			return "执行准入拒绝";
		case "execution.cancel_requested":
			return "执行取消已请求";
		case "execution.cancelled":
			return "执行已取消";
		case "execution.bridge_failed":
			return "执行桥接失败";
		case "execution.timed_out":
			return "执行超时";
		default:
			return value;
	}
}

export function formatAuditStatus(value: string) {
	switch (value) {
		case "accepted":
		case "completed":
		case "needs_clarification":
		case "approval_required":
		case "rejected":
		case "no_answer":
		case "error":
			return PANEL_COPY.requestStatus[value];
		case "allowed":
			return "允许";
		case "denied":
			return "拒绝";
		case "open":
			return "待处理";
		case "closed":
			return "已关闭";
		default:
			return value;
	}
}

export function buildAuditDiagnosticEntries(input: {
	aclAnomalyCode: string | null;
	bridgeDurationMs?: number | null;
	decision?: string | null;
	durationMs?: number | null;
	failClosed: boolean | null;
	failureKind?: string | null;
	httpStatus?: number | null;
	lane?: string | null;
	queueWaitMs?: number | null;
	retryable?: boolean | null;
	sourceDocIds: string[];
}) {
	const entries: Array<{ label: string; value: string }> = [];

	if (input.failClosed !== null) {
		entries.push({
			label: "拒绝保护",
			value: input.failClosed ? PANEL_COPY.yes : PANEL_COPY.no,
		});
	}
	if (input.aclAnomalyCode) {
		entries.push({
			label: "授权异常",
			value: input.aclAnomalyCode,
		});
	}
	if (input.lane) {
		entries.push({
			label: "执行通道",
			value: input.lane,
		});
	}
	if (input.decision) {
		entries.push({
			label: "执行决策",
			value: input.decision,
		});
	}
	if (input.failureKind) {
		entries.push({
			label: "失败类型",
			value: input.failureKind,
		});
	}
	if (input.httpStatus !== null && input.httpStatus !== undefined) {
		entries.push({
			label: "HTTP 状态",
			value: String(input.httpStatus),
		});
	}
	if (input.retryable !== null && input.retryable !== undefined) {
		entries.push({
			label: "可重试",
			value: input.retryable ? PANEL_COPY.yes : PANEL_COPY.no,
		});
	}
	if (input.queueWaitMs !== null && input.queueWaitMs !== undefined) {
		entries.push({
			label: "排队等待",
			value: `${input.queueWaitMs} ms`,
		});
	}
	if (input.bridgeDurationMs !== null && input.bridgeDurationMs !== undefined) {
		entries.push({
			label: "桥接耗时",
			value: `${input.bridgeDurationMs} ms`,
		});
	}
	if (input.durationMs !== null && input.durationMs !== undefined) {
		entries.push({
			label: "总耗时",
			value: `${input.durationMs} ms`,
		});
	}
	if (input.sourceDocIds.length > 0) {
		entries.push({
			label: "来源文档",
			value: input.sourceDocIds.join(" · "),
		});
	}

	return entries;
}
