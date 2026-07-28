import { EmailAccessGrantPageSchema, EmailAccessGrantSchema } from "campus-contracts/email-access";

export interface EmailAccessAdminEnv {
	OPS_WEB_APP_API_URL?: string;
	OPS_WEB_INTERNAL_TOKEN?: string;
}

export class EmailAccessAdminUnavailableError extends Error {}

export class EmailAccessAdminResponseError extends Error {
	readonly response: Response;

	constructor(response: Response) {
		super(`Email access admin API returned HTTP ${response.status}.`);
		this.response = response;
	}
}

export function createEmailAccessAdminClient(
	env: EmailAccessAdminEnv,
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
	) {
		if (!(baseUrl && token)) {
			throw new EmailAccessAdminUnavailableError(
				"App API email access administration is not configured.",
			);
		}
		let response: Response;
		try {
			response = await fetchImplementation(
				`${baseUrl}/api/internal/admin/email-access-grants${path}`,
				{
					body: options.body === undefined ? undefined : JSON.stringify(options.body),
					headers: {
						authorization: `Bearer ${token}`,
						...(options.body === undefined ? {} : { "content-type": "application/json" }),
						...(options.actorId ? { "x-ops-actor-id": options.actorId } : {}),
						...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
					},
					method: options.method ?? "GET",
					signal: AbortSignal.timeout(15_000),
				},
			);
		} catch (error) {
			throw new EmailAccessAdminUnavailableError(
				error instanceof Error
					? error.message
					: "App API email access administration is unavailable.",
			);
		}
		const body = (await response.json().catch(() => null)) as unknown;
		if (!response.ok) {
			throw new EmailAccessAdminResponseError(
				new Response(JSON.stringify(body), {
					headers: { "content-type": "application/json; charset=utf-8" },
					status: response.status,
				}),
			);
		}
		return body;
	}
	return {
		async list(search: URLSearchParams) {
			const query = search.size > 0 ? `?${search.toString()}` : "";
			const page = await request(query);
			return EmailAccessGrantPageSchema.parse(page);
		},
		async command(path: string, body: unknown, actorId: string, idempotencyKey: string) {
			return EmailAccessGrantSchema.parse(
				await request(path, { actorId, body, idempotencyKey, method: "POST" }),
			);
		},
	};
}
