import {
	AccountAdminEventPageSchema,
	AccountAdminUserDetailSchema,
	AccountAdminUserPageSchema,
	AccountDeletionAdminPageSchema,
	TemporaryPasswordResponseSchema,
} from "campus-contracts/account-admin";

export interface AccountAdminEnv {
	OPS_WEB_APP_API_URL?: string;
	OPS_WEB_INTERNAL_TOKEN?: string;
}

export class AccountAdminUnavailableError extends Error {}

export class AccountAdminResponseError extends Error {
	readonly response: Response;

	constructor(response: Response) {
		super(`Account administration API returned HTTP ${response.status}.`);
		this.response = response;
	}
}

export function createAccountAdminClient(
	env: AccountAdminEnv,
	input: { fetchImplementation?: typeof fetch } = {},
) {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const baseUrl = env.OPS_WEB_APP_API_URL?.trim().replace(/\/$/u, "");
	const token = env.OPS_WEB_INTERNAL_TOKEN?.trim();

	async function request(
		path: string,
		options: {
			actorId?: string;
			body?: unknown;
			idempotencyKey?: string;
			method?: "GET" | "POST";
		} = {},
	): Promise<unknown> {
		if (!(baseUrl && token)) {
			throw new AccountAdminUnavailableError("App API account administration is not configured.");
		}
		let response: Response;
		try {
			response = await fetchImplementation(`${baseUrl}/api/internal/admin${path}`, {
				body: options.body === undefined ? undefined : JSON.stringify(options.body),
				headers: {
					authorization: `Bearer ${token}`,
					...(options.body === undefined ? {} : { "content-type": "application/json" }),
					...(options.actorId ? { "x-ops-actor-id": options.actorId } : {}),
					...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
				},
				method: options.method ?? "GET",
				signal: AbortSignal.timeout(15_000),
			});
		} catch (error) {
			throw new AccountAdminUnavailableError(
				error instanceof Error ? error.message : "App API account administration is unavailable.",
			);
		}
		const body = (await response.json().catch(() => null)) as unknown;
		if (!response.ok) {
			throw new AccountAdminResponseError(
				new Response(JSON.stringify(body), {
					headers: { "content-type": "application/json; charset=utf-8" },
					status: response.status,
				}),
			);
		}
		return body;
	}

	return {
		async commandUser(
			userId: string,
			action: string,
			body: unknown,
			actorId: string,
			idempotencyKey: string,
		) {
			const result = await request(`/users/${encodeURIComponent(userId)}/${action}`, {
				actorId,
				body,
				idempotencyKey,
				method: "POST",
			});
			return action === "temporary-password"
				? TemporaryPasswordResponseSchema.parse(result)
				: AccountAdminUserDetailSchema.parse(result);
		},
		async getUser(userId: string) {
			return AccountAdminUserDetailSchema.parse(
				await request(`/users/${encodeURIComponent(userId)}`),
			);
		},
		async listEvents(search: URLSearchParams) {
			const query = search.size > 0 ? `?${search.toString()}` : "";
			return AccountAdminEventPageSchema.parse(await request(`/account-events${query}`));
		},
		async listDeletions(search: URLSearchParams) {
			const query = search.size > 0 ? `?${search.toString()}` : "";
			return AccountDeletionAdminPageSchema.parse(await request(`/account-deletions${query}`));
		},
		async listUsers(search: URLSearchParams) {
			const query = search.size > 0 ? `?${search.toString()}` : "";
			return AccountAdminUserPageSchema.parse(await request(`/users${query}`));
		},
		async retryDeletion(requestId: string, body: unknown, actorId: string, idempotencyKey: string) {
			return await request(`/account-deletions/${encodeURIComponent(requestId)}/retry`, {
				actorId,
				body,
				idempotencyKey,
				method: "POST",
			});
		},
		async revokeSession(
			userId: string,
			sessionId: string,
			actorId: string,
			idempotencyKey: string,
		) {
			return AccountAdminUserDetailSchema.parse(
				await request(
					`/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}/revoke`,
					{
						actorId,
						body: {},
						idempotencyKey,
						method: "POST",
					},
				),
			);
		},
	};
}
