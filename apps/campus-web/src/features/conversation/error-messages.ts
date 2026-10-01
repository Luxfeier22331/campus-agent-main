const CHAT_REQUEST_ERROR_MESSAGES: Record<string, string> = {
	approval_required: "该请求需要审批后才能继续。",
	answer_synthesis_failed: "已找到部分资料，但生成最终回答失败，请稍后重试。",
	chat_stream_connection_lost: "回答连接已断开。",
	context_budget_exceeded: "当前对话过长，暂时无法继续处理，请开启新会话再试。",
	conversation_refresh_failed: "回答已完成，但会话内容暂时无法刷新。",
	dependency_not_ready: "服务尚未就绪，请稍后重试。",
	execution_cancelled: "已取消本次回答。",
	execution_control_invalid_error_envelope: "回答服务返回异常，请稍后重试。",
	execution_control_invalid_response: "回答服务返回异常，请稍后重试。",
	execution_control_unavailable: "回答服务暂时不可用，请稍后重试。",
	execution_invalid_public_response: "回答服务返回异常，请稍后重试。",
	execution_runtime_required: "执行环境未就绪，请稍后重试。",
	execution_status_pending: "回答仍在处理中，请稍候。",
	execution_timeout: "本次回答超时，未能完成。",
	forbidden: "没有权限执行该请求。",
	idempotency_conflict: "请求处理中发生冲突，请重试。",
	internal_error: "回答失败，请稍后重试。",
	invalid_error_response: "请求返回了无效错误结构。",
	invalid_request: "请求无效，请调整后重试。",
	invalid_request_status_response: "回答状态返回了无效数据。",
	invalid_stream_event: "回答连接返回了无效事件。",
	materials_insufficient: "暂未找到足够的校内资料来回答这个问题。",
	max_turns_exceeded: "回答未能在此问题的允许步骤内完成，请换个问法重试。",
	personal_memory_not_configured: "个人记忆暂不可用，本次请求未能完成。",
	product_finalization_missing: "回答结果暂未生成，请稍后重试。",
	provider_unavailable: "回答服务暂时不可用，请稍后重试。",
	rate_limit_exceeded: "请求过于频繁，请几分钟后再试。",
	request_cancel_failed: "取消请求失败，当前回答仍在继续。",
	request_not_found: "请求不存在或已过期。",
	request_rejected: "请求被策略拒绝，无法继续回答。",
	request_status_timeout: "查询回答状态超时，请稍后重试。",
	run_expired: "请求超时未完成，请重试。",
	run_failed: "回答失败，请稍后重试。",
	runtime_invariant_failed: "回答服务内部异常，请稍后重试。",
	tool_execution_failed: "回答所需的工具执行失败，请稍后重试。",
	validation_failed: "请求无效，请调整后重试。",
};

export const GENERIC_CHAT_REQUEST_ERROR_MESSAGE = "回答失败，请稍后重试。";

const CJK_TEXT_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/u;

export function containsCjkText(text: string): boolean {
	return CJK_TEXT_PATTERN.test(text);
}

export function localizeChatErrorMessage(input: {
	code?: null | string;
	message?: null | string;
}): string {
	const code = input.code?.trim();
	if (code && CHAT_REQUEST_ERROR_MESSAGES[code]) {
		return CHAT_REQUEST_ERROR_MESSAGES[code];
	}
	const message = input.message?.trim();
	if (message && containsCjkText(message)) {
		return message;
	}
	return GENERIC_CHAT_REQUEST_ERROR_MESSAGE;
}
