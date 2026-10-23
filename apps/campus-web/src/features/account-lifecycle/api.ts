export interface AccountDeletionReceipt {
	requestId: string;
	status: "deleting";
}

const ACCOUNT_DELETION_ERROR_MESSAGES: Record<string, string> = {
	ACCOUNT_NOT_ACTIVE: "当前账号不可注销。",
	REAUTHENTICATION_REQUIRED: "当前密码不正确。",
};

export async function requestAccountDeletion(password: string): Promise<AccountDeletionReceipt> {
	const response = await fetch("/api/account/delete", {
		body: JSON.stringify({ password }),
		headers: { "content-type": "application/json" },
		method: "POST",
	});
	const payload = (await response.json().catch(() => null)) as
		| AccountDeletionReceipt
		| { error?: { code?: string; message?: string } }
		| null;
	if (!response.ok) {
		const errorCode = payload && "error" in payload ? payload.error?.code : undefined;
		throw new Error(
			(errorCode && ACCOUNT_DELETION_ERROR_MESSAGES[errorCode]) ??
				"账号注销请求未完成，请稍后重试。",
		);
	}
	if (!(payload && "requestId" in payload && payload.status === "deleting")) {
		throw new Error("账号注销接口返回了无效结果。");
	}
	return payload;
}
