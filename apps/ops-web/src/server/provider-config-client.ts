import { ProviderConfigStatusSchema } from "../shared/ops-contract.ts";

export interface ProviderConfigAdminEnv {
	OPS_WEB_EXECUTION_CONTROL_ADMIN_URL?: string;
	OPS_WEB_EXECUTION_CONTROL_PROVIDER_COMMAND_TOKEN?: string;
	OPS_WEB_EXECUTION_CONTROL_PROVIDER_READ_TOKEN?: string;
}

export class ProviderConfigAdminUnavailableError extends Error {}

export class ProviderConfigAdminResponseError extends Error {
	readonly response: Response;

	constructor(response: Response) {
		super(`Provider config admin API returned HTTP ${response.status}.`);
		this.response = response;
	}
}

export function createProviderConfigAdminClient(
	env: ProviderConfigAdminEnv,
	input: { fetchImplementation?: typeof fetch } = {},
) {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const baseUrl = env.OPS_WEB_EXECUTION_CONTROL_ADMIN_URL?.trim().replace(/\/$/u, "");
	async function request(
		path: string,
		options: { actorId?: string; body?: unknown; command: boolean; idempotencyKey?: string },
	) {
		const token = (
			options.command
				? env.OPS_WEB_EXECUTION_CONTROL_PROVIDER_COMMAND_TOKEN
				: env.OPS_WEB_EXECUTION_CONTROL_PROVIDER_READ_TOKEN
		)?.trim();
		if (!(baseUrl && token)) {
			throw new ProviderConfigAdminUnavailableError("Provider config admin API is not configured.");
		}
		let response: Response;
		try {
			response = await fetchImplementation(`${baseUrl}/internal/admin/provider-config${path}`, {
				body: options.body === undefined ? undefined : JSON.stringify(options.body),
				headers: {
					authorization: `Bearer ${token}`,
					...(options.body === undefined ? {} : { "content-type": "application/json" }),
					...(options.actorId ? { "x-ops-actor-id": options.actorId } : {}),
					...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
				},
				method: options.command ? "POST" : "GET",
				signal: AbortSignal.timeout(15_000),
			});
		} catch (error) {
			throw new ProviderConfigAdminUnavailableError(
				error instanceof Error ? error.message : "Provider config admin API is unavailable.",
			);
		}
		const body = (await response.json().catch(() => null)) as unknown;
		if (!response.ok) {
			throw new ProviderConfigAdminResponseError(
				new Response(
					JSON.stringify(
						body ?? {
							error: {
								code: "PROVIDER_CONFIG_ADMIN_ERROR",
								message: "Provider config command failed.",
							},
						},
					),
					{
						headers: { "content-type": "application/json; charset=utf-8" },
						status: response.status,
					},
				),
			);
		}
		return body;
	}
	return {
		async getStatus() {
			return ProviderConfigStatusSchema.parse(await request("", { command: false }));
		},
		command(path: string, body: unknown, actorId: string, idempotencyKey: string) {
			return request(path, { actorId, body, command: true, idempotencyKey });
		},
	};
}
