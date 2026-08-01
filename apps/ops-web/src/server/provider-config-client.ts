import type { z } from "zod";
import {
	ExecutionModelSettingsStatusSchema,
	ModelDiscoveryRequestSchema,
	ModelDiscoveryResponseSchema,
	type ModelSettingKindSchema,
	ModelSettingUpdateSchema,
	ModelSettingValidationResponseSchema,
} from "../shared/ops-contract.ts";

type ModelSettingKind = z.infer<typeof ModelSettingKindSchema>;

export interface ProviderConfigAdminEnv {
	OPS_WEB_EXECUTION_CONTROL_ADMIN_URL?: string;
	OPS_WEB_INTERNAL_TOKEN?: string;
}

export class ProviderConfigAdminUnavailableError extends Error {}

export class ProviderConfigAdminResponseError extends Error {
	readonly response: Response;
	readonly upstreamCode: string;

	constructor(response: Response, upstreamCode = "model_settings_error") {
		super(`Model settings admin API returned HTTP ${response.status}.`);
		this.response = response;
		this.upstreamCode = upstreamCode;
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
		options: {
			actorId?: string;
			body?: unknown;
			etag?: string;
			method: "GET" | "POST" | "PUT";
		},
	) {
		const token = env.OPS_WEB_INTERNAL_TOKEN?.trim();
		if (!(baseUrl && token)) {
			throw new ProviderConfigAdminUnavailableError("Model settings admin API is not configured.");
		}
		let response: Response;
		try {
			response = await fetchImplementation(`${baseUrl}/internal/admin/model-settings${path}`, {
				body: options.body === undefined ? undefined : JSON.stringify(options.body),
				headers: {
					authorization: `Bearer ${token}`,
					...(options.actorId ? { "x-ops-actor-id": options.actorId } : {}),
					...(options.body === undefined ? {} : { "content-type": "application/json" }),
					...(options.etag ? { "if-match": options.etag } : {}),
				},
				method: options.method,
				signal: AbortSignal.timeout(15_000),
			});
		} catch (error) {
			throw new ProviderConfigAdminUnavailableError(
				error instanceof Error ? error.message : "Model settings admin API is unavailable.",
			);
		}
		const body = (await response.json().catch(() => null)) as unknown;
		if (!response.ok) {
			throw new ProviderConfigAdminResponseError(
				new Response(JSON.stringify(body), {
					headers: { "content-type": "application/json; charset=utf-8" },
					status: response.status,
				}),
				providerConfigErrorCode(body),
			);
		}
		return body;
	}

	return {
		discoverModels(body: z.input<typeof ModelDiscoveryRequestSchema>, actorId: string) {
			return request("/llm/models", {
				actorId,
				body: ModelDiscoveryRequestSchema.parse(body),
				method: "POST",
			}).then((response) => ModelDiscoveryResponseSchema.parse(response));
		},
		async getStatus() {
			return ExecutionModelSettingsStatusSchema.parse(await request("", { method: "GET" }));
		},
		async put(
			kind: ModelSettingKind,
			body: z.input<typeof ModelSettingUpdateSchema>,
			actorId: string,
			etag: string,
		) {
			return ExecutionModelSettingsStatusSchema.parse(
				await request(`/${kind}`, {
					actorId,
					body: ModelSettingUpdateSchema.parse(body),
					etag,
					method: "PUT",
				}),
			);
		},
		validate(kind: ModelSettingKind, actorId: string) {
			return request(`/${kind}/validate`, { actorId, method: "POST" }).then((body) =>
				ModelSettingValidationResponseSchema.parse(body),
			);
		},
	};
}

function providerConfigErrorCode(body: unknown) {
	if (!body || typeof body !== "object" || !("error" in body)) {
		return "model_settings_error";
	}
	const error = body.error;
	return error && typeof error === "object" && "code" in error && typeof error.code === "string"
		? error.code
		: "model_settings_error";
}
