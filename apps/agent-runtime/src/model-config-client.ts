import type { PromptProviderRuntimeConfig } from "./agent-run-contract.ts";

export interface ModelConfigClientOptions {
	baseUrl: string;
	fetchImplementation?: typeof fetch;
}

interface RuntimeConfigResponse {
	api_key: string;
	api_protocol: string;
	base_url: string;
	model: string;
	name: "primary_agent";
	provider: string;
	schema_version: "model_runtime_config.v1";
	target_sha256: string;
	capabilities?: {
		hosted_web_search?: boolean;
	};
}

export class ModelConfigClientError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(message: string, status: number, code: string) {
		super(message);
		this.name = "ModelConfigClientError";
		this.status = status;
		this.code = code;
	}
}

export async function resolveModelRuntimeConfig(
	options: ModelConfigClientOptions,
	expectedTargetSha256: string,
	signal?: AbortSignal,
): Promise<PromptProviderRuntimeConfig> {
	const baseUrl = options.baseUrl.trim().replace(/\/+$/u, "");
	if (!baseUrl) {
		throw new ModelConfigClientError(
			"Model Config is not configured.",
			503,
			"model_config_unavailable",
		);
	}
	let response: Response;
	try {
		const query = new URLSearchParams({ expected_target_sha256: expectedTargetSha256 });
		response = await (options.fetchImplementation ?? fetch)(
			`${baseUrl}/internal/model-configs/primary_agent?${query}`,
			{
				headers: { accept: "application/json" },
				method: "GET",
				redirect: "error",
				signal: AbortSignal.any([AbortSignal.timeout(5_000), ...(signal ? [signal] : [])]),
			},
		);
	} catch {
		signal?.throwIfAborted();
		throw new ModelConfigClientError(
			"Model Config is unavailable.",
			503,
			"model_config_unavailable",
		);
	}
	if (!response.ok) {
		const code = response.status === 409 ? "model_target_mismatch" : "model_config_unavailable";
		throw new ModelConfigClientError(
			"Model Config did not resolve the requested target.",
			response.status,
			code,
		);
	}
	let payload: unknown;
	try {
		payload = (await response.json()) as RuntimeConfigResponse;
	} catch {
		signal?.throwIfAborted();
		throw new ModelConfigClientError(
			"Model Config returned invalid JSON.",
			503,
			"model_config_unavailable",
		);
	}
	if (!isRuntimeConfigResponse(payload)) {
		throw new ModelConfigClientError(
			"Model Config returned an invalid runtime contract.",
			503,
			"model_config_unavailable",
		);
	}
	return {
		...(payload.capabilities?.hosted_web_search === true ? { hostedWebSearch: true } : {}),
		provider: payload.provider,
		transport:
			payload.api_protocol === "google.generate_content"
				? "generate_content"
				: payload.api_protocol === "openai.responses"
					? "responses"
					: "chat_completions",
		baseUrl: payload.base_url,
		model: payload.model,
		apiKey: payload.api_key,
	};
}

function isRuntimeConfigResponse(value: unknown): value is RuntimeConfigResponse {
	if (!isRecord(value)) {
		return false;
	}
	const expectedKeys = [
		"api_key",
		"api_protocol",
		"base_url",
		"model",
		"name",
		"provider",
		"schema_version",
		"target_sha256",
	];
	const keys = Object.keys(value).sort();
	const legacyKeys = expectedKeys.join("\n");
	const capabilityKeys = [...expectedKeys, "capabilities"].sort().join("\n");
	if (keys.join("\n") !== legacyKeys && keys.join("\n") !== capabilityKeys) {
		return false;
	}
	if (
		"capabilities" in value &&
		(!isRecord(value.capabilities) ||
			Object.keys(value.capabilities).some((key) => key !== "hosted_web_search") ||
			typeof value.capabilities.hosted_web_search !== "boolean")
	) {
		return false;
	}
	return (
		value.schema_version === "model_runtime_config.v1" &&
		value.name === "primary_agent" &&
		((value.provider === "google" && value.api_protocol === "google.generate_content") ||
			((value.provider === "openai" || value.provider === "openai-compatible") &&
				(value.api_protocol === "openai.responses" ||
					value.api_protocol === "openai.chat_completions"))) &&
		nonEmptyString(value.api_key) &&
		nonEmptyString(value.base_url) &&
		nonEmptyString(value.model) &&
		typeof value.target_sha256 === "string" &&
		/^[0-9a-f]{64}$/u.test(value.target_sha256)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}
