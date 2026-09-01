import { OpsApiError } from "./ops-api/core";

export type StandardAction =
	| "ban"
	| "password-reset-email"
	| "sessions-revoke-all"
	| "unban"
	| "verification-email";

export type ReasonedAction = Extract<StandardAction, "ban" | "sessions-revoke-all" | "unban">;

export type Confirmation =
	| {
			action: ReasonedAction;
			confirmLabel: string;
			description: string;
			kind: "command";
			reason: string;
			title: string;
	  }
	| {
			confirmLabel: string;
			description: string;
			kind: "session";
			sessionId: string;
			title: string;
	  };

export interface StandardCommandAttempt {
	action: StandardAction;
	idempotencyKey: string;
	payload: Record<string, never> | { reason: string };
	successMessage: string;
}

export interface TemporaryPasswordAttempt {
	idempotencyKey: string;
	reason: string;
}

export interface SessionCommandAttempt {
	idempotencyKey: string;
	sessionId: string;
}

export type RetryableAttempt =
	| { kind: "command"; value: StandardCommandAttempt }
	| { kind: "session"; value: SessionCommandAttempt }
	| { kind: "temporary-password"; value: TemporaryPasswordAttempt };

export function retryableCommandError(error: unknown): boolean {
	return !(
		error instanceof OpsApiError &&
		error.status < 500 &&
		error.code !== "account_admin_command_in_progress"
	);
}

export function commandSuccessMessage(action: StandardAction): string {
	return {
		ban: "账号已封禁。",
		"password-reset-email": "密码重置邮件已提交发送。",
		"sessions-revoke-all": "全部会话已撤销。",
		unban: "账号已恢复。",
		"verification-email": "邮箱验证邮件已提交发送。",
	}[action];
}
