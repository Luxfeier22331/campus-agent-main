import type { OpsRequestSummary } from "../shared/ops-contract";

const LIFECYCLE_LABELS: Record<OpsRequestSummary["lifecyclePhase"], string> = {
	FINALIZING: "写入结果",
	FINISHED: "已结束",
	QUEUED: "已排队",
	RUNNING: "执行中",
	STREAMING: "输出中",
};

const VALUE_LABELS: Record<string, string> = {
	ACTION_REQUIRED: "等待用户",
	CAMPUS_WEB: "Campus Web",
	CANCELLED: "已取消",
	COMPLETED: "已完成",
	FAILED: "失败",
	MODEL_PROVIDER_TIMEOUT: "模型服务超时",
	OTHER: "其他入口",
	PENDING: "待处理",
	RUNNING: "运行中",
	allowed: "允许",
	answer: "已生成回答",
	answer_completed: "回答已完成",
	agent: "Agent",
	agentRuntime: "Agent 运行时",
	canceled: "已取消",
	chat_completions: "Chat Completions API",
	completed: "已完成",
	direct: "直接回答",
	embeddings: "Embeddings API",
	error: "错误",
	executionControl: "执行编排",
	failed: "失败",
	open: "未解决",
	primary_agent: "主 Agent",
	primary_agent_completed: "主 Agent 已完成",
	provider_unavailable: "模型服务不可用",
	resolved: "已解决",
	responses: "Responses API",
	running: "执行中",
	runtime_error: "运行时错误",
	single_step: "单步执行",
	staff: "教职工",
	student: "学生",
	student_rules: "学生规则",
	system: "系统",
	terminal: "终态处理",
	tool: "工具调用",
	tool_call: "工具调用",
	unresolved: "未解决",
};

export function formatLifecyclePhase(value: OpsRequestSummary["lifecyclePhase"]) {
	return LIFECYCLE_LABELS[value];
}

export function formatOpsDomainValue(value: string | null | undefined, emptyLabel = "未记录") {
	if (!value) {
		return emptyLabel;
	}
	return VALUE_LABELS[value] ?? value;
}
