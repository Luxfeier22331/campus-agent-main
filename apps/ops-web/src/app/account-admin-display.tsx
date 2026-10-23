import { Badge } from "@campus-agent/ui";
import type {
	AccountAdminAccessSource,
	AccountAdminAccessState,
	AccountAdminEvent,
	AccountAdminOutcome,
	AccountAdminState,
} from "campus-contracts/account-admin";

const stateLabels: Record<AccountAdminState, string> = {
	active: "未封禁",
	banned: "已封禁",
	deleting: "注销中",
	password_change_required: "待修改密码",
	unverified: "邮箱未验证",
};

export function AccountStateBadge({ state }: { state: AccountAdminState }) {
	const tone =
		state === "active"
			? "success"
			: state === "banned" || state === "deleting"
				? "danger"
				: "warning";
	return <Badge tone={tone}>{stateLabels[state]}</Badge>;
}

const accessLabels: Record<AccountAdminAccessState, string> = {
	allowed: "可访问",
	denied: "不可访问",
};

export function AccountAccessBadge({
	source,
	state,
}: {
	source: AccountAdminAccessSource;
	state: AccountAdminAccessState;
}) {
	const detail =
		source === "campus_email" ? "校园邮箱" : source === "email_grant" ? "邮箱授权" : null;
	return (
		<Badge tone={state === "allowed" ? "success" : "danger"}>
			{accessLabels[state]}
			{detail ? ` · ${detail}` : ""}
		</Badge>
	);
}

export function accountStateLabel(state: AccountAdminState): string {
	return stateLabels[state];
}

const actionLabels: Record<AccountAdminEvent["action"], string> = {
	account_banned: "封禁账号",
	account_unbanned: "恢复账号",
	password_reset_email_sent: "发送重置邮件",
	session_revoked: "撤销会话",
	sessions_revoked: "撤销全部会话",
	temporary_password_issued: "签发临时密码",
	verification_email_sent: "发送验证邮件",
};

export function accountActionLabel(action: AccountAdminEvent["action"]): string {
	return actionLabels[action];
}

const outcomeLabels: Record<AccountAdminOutcome, string> = {
	failed: "失败",
	indeterminate: "结果未确认",
	started: "执行中",
	succeeded: "成功",
};

export function AccountOutcomeBadge({ outcome }: { outcome: AccountAdminOutcome }) {
	const tone = outcome === "succeeded" ? "success" : outcome === "failed" ? "danger" : "warning";
	return <Badge tone={tone}>{outcomeLabels[outcome]}</Badge>;
}
