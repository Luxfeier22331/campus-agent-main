export type AccountSessionState =
	| "loading"
	| "network_error"
	| "ready"
	| "service_unavailable"
	| "unauthenticated";

interface AccountSessionResult {
	email: string | null;
	state: AccountSessionState;
}

interface AccountSessionPayload {
	principal: {
		email: string;
	};
}

export async function loadAccountSession(
	fetchImplementation: typeof fetch = fetch,
): Promise<AccountSessionResult> {
	try {
		const response = await fetchImplementation("/api/me", {
			credentials: "include",
			headers: { accept: "application/json" },
		});
		if (response.status === 401) {
			return { email: null, state: "unauthenticated" };
		}
		if (!response.ok) {
			return { email: null, state: "service_unavailable" };
		}
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.includes("application/json")) {
			return { email: null, state: "service_unavailable" };
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			return { email: null, state: "service_unavailable" };
		}
		if (!isAccountSessionPayload(payload)) {
			return { email: null, state: "service_unavailable" };
		}
		return { email: payload.principal.email.trim(), state: "ready" };
	} catch {
		return { email: null, state: "network_error" };
	}
}

function isAccountSessionPayload(value: unknown): value is AccountSessionPayload {
	if (
		typeof value !== "object" ||
		value === null ||
		!("principal" in value) ||
		typeof value.principal !== "object" ||
		value.principal === null ||
		!("email" in value.principal) ||
		typeof value.principal.email !== "string"
	) {
		return false;
	}
	return value.principal.email.trim().length > 0;
}
