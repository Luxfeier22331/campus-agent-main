import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient();

export interface SignOutChatSessionOptions {
	redirectTo?: string;
}

interface ClientAuthResponse {
	error?: {
		message?: string;
	} | null;
}

function readAuthErrorMessage(
	response: ClientAuthResponse | undefined,
	defaultMessage: string,
): string {
	const message = response?.error?.message?.trim();
	return message || defaultMessage;
}

export async function signOutChatSession(options: SignOutChatSessionOptions = {}): Promise<void> {
	const { redirectTo } = options;
	const response = await authClient.signOut({
		fetchOptions: redirectTo
			? {
					onSuccess() {
						window.location.assign(redirectTo);
					},
				}
			: undefined,
	});
	if (response?.error) {
		throw new Error(readAuthErrorMessage(response, "暂时无法退出登录。"));
	}
}
