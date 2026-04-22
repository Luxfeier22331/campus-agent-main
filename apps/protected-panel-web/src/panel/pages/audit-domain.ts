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
	failClosed: boolean | null;
	sourceDocIds: string[];
}) {
	const entries: Array<{ label: string; value: string }> = [];

	if (input.failClosed !== null) {
		entries.push({
			label: "Fail Closed",
			value: input.failClosed ? PANEL_COPY.yes : PANEL_COPY.no,
		});
	}
	if (input.aclAnomalyCode) {
		entries.push({
			label: "ACL 异常",
			value: input.aclAnomalyCode,
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
