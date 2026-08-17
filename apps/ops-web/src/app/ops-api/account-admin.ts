import {
	type AccountAdminAccessState,
	type AccountAdminEvent,
	AccountAdminEventPageSchema,
	type AccountAdminState,
	AccountAdminUserDetailSchema,
	AccountAdminUserPageSchema,
	TemporaryPasswordResponseSchema,
} from "campus-contracts/account-admin";
import { fetchJson } from "./core";

export async function fetchAccountAdminUsers(
	params: {
		access?: AccountAdminAccessState;
		cursor?: string;
		limit?: number;
		query?: string;
		state?: AccountAdminState;
	} = {},
	input: { signal?: AbortSignal } = {},
) {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== "") {
			search.set(key, String(value));
		}
	}
	return AccountAdminUserPageSchema.parse(
		await fetchJson(`/api/ops/users${search.size > 0 ? `?${search}` : ""}`, {
			signal: input.signal,
		}),
	);
}

export async function fetchAccountAdminUser(userId: string, input: { signal?: AbortSignal } = {}) {
	return AccountAdminUserDetailSchema.parse(
		await fetchJson(`/api/ops/users/${encodeURIComponent(userId)}`, { signal: input.signal }),
	);
}

export async function fetchAccountAdminEvents(
	params: {
		action?: AccountAdminEvent["action"];
		actorId?: string;
		cursor?: string;
		limit?: number;
		outcome?: AccountAdminEvent["outcome"];
		targetUserId?: string;
		window?: "24h" | "7d" | "30d" | "90d";
	} = {},
	input: { signal?: AbortSignal } = {},
) {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== "") {
			search.set(key, String(value));
		}
	}
	return AccountAdminEventPageSchema.parse(
		await fetchJson(`/api/ops/account-events${search.size > 0 ? `?${search}` : ""}`, {
			signal: input.signal,
		}),
	);
}

export async function commandAccountAdminUser(
	userId: string,
	action:
		| "ban"
		| "password-reset-email"
		| "sessions-revoke-all"
		| "temporary-password"
		| "unban"
		| "verification-email",
	payload: Record<string, never> | { reason: string },
	input: { idempotencyKey: string },
) {
	const response = await fetchJson(`/api/ops/users/${encodeURIComponent(userId)}/${action}`, {
		body: JSON.stringify(payload),
		headers: {
			"content-type": "application/json",
			"idempotency-key": input.idempotencyKey,
		},
		method: "POST",
	});
	return action === "temporary-password"
		? TemporaryPasswordResponseSchema.parse(response)
		: AccountAdminUserDetailSchema.parse(response);
}

export async function revokeAccountAdminSession(
	userId: string,
	sessionId: string,
	input: { idempotencyKey: string },
) {
	return AccountAdminUserDetailSchema.parse(
		await fetchJson(
			`/api/ops/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}/revoke`,
			{
				body: "{}",
				headers: {
					"content-type": "application/json",
					"idempotency-key": input.idempotencyKey,
				},
				method: "POST",
			},
		),
	);
}
