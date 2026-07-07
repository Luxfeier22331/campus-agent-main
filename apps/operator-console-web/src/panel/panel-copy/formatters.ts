import { PANEL_COPY } from "./copy";

const RUNTIME_ERROR_MESSAGES: Record<string, string> = {
	access_reentry_required: "当前受保护访问会话已失效，请重新进入面板。",
	cursor_not_available: "当前分页游标不可用，请按顺序逐页浏览。",
	dependency_not_ready: "面板运行时依赖尚未就绪。",
	forbidden: "当前身份没有运维面板访问权限。",
	frontend_assets_not_ready: "面板前端资源尚未就绪。",
	internal_error: "服务暂时不可用，请稍后重试。",
	invalid_runtime_payload: "返回数据格式异常，请联系维护人员。",
	not_found: "未找到请求的资源。",
	operator_identity_required: "当前会话缺少可信运维身份，无法访问该受保护接口。",
};

export function formatPanelTimestamp(value: string | null) {
	if (!value) {
		return PANEL_COPY.pending;
	}

	return new Intl.DateTimeFormat("zh-CN", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

export function translateRuntimeErrorMessage(input: {
	code?: string | null;
	message?: string | null;
	statusText?: string;
}) {
	const code = input.code?.trim();
	if (code && RUNTIME_ERROR_MESSAGES[code]) {
		return RUNTIME_ERROR_MESSAGES[code];
	}

	const message = input.message?.trim();
	if (message) {
		return message;
	}

	return input.statusText?.trim() || "请求失败。";
}
