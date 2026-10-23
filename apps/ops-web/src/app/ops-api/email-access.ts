import {
	type CreateEmailAccessGrant,
	EmailAccessGrantPageSchema,
	EmailAccessGrantSchema,
} from "campus-contracts/email-access";
import { fetchJson } from "./core";

export async function fetchEmailAccessGrants(
	params: {
		cursor?: string;
		email?: string;
		kind?: "invitation" | "test";
		state?: "pending" | "active" | "revoked" | "expired";
	} = {},
	input: { signal?: AbortSignal } = {},
) {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value) {
			search.set(key, value);
		}
	}
	return EmailAccessGrantPageSchema.parse(
		await fetchJson(`/api/ops/email-access-grants${search.size > 0 ? `?${search}` : ""}`, {
			signal: input.signal,
		}),
	);
}

export async function createEmailAccessGrant(
	payload: CreateEmailAccessGrant,
	input: { idempotencyKey: string },
) {
	return EmailAccessGrantSchema.parse(
		await fetchJson("/api/ops/email-access-grants", {
			body: JSON.stringify(payload),
			headers: {
				"content-type": "application/json",
				"idempotency-key": input.idempotencyKey,
			},
			method: "POST",
		}),
	);
}

export async function commandEmailAccessGrant(
	grantId: string,
	action: "resend" | "revoke",
	input: { idempotencyKey: string },
) {
	return EmailAccessGrantSchema.parse(
		await fetchJson(`/api/ops/email-access-grants/${encodeURIComponent(grantId)}/${action}`, {
			body: "{}",
			headers: {
				"content-type": "application/json",
				"idempotency-key": input.idempotencyKey,
			},
			method: "POST",
		}),
	);
}
