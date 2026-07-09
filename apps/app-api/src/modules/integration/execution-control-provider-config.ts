import type { Env } from "../../config";
import type { TracePropagationHeaders } from "../telemetry/trace";
import {
	createExecutionControlRequester,
	defaultRuntimeFetch,
	type JsonRecord,
} from "./execution-control-runtime";
import { ExecutionControlTransportError } from "./execution-control-transport";

type ExecutionControlRuntimeEnv = Pick<
	Env,
	| "APP_API_ENVIRONMENT"
	| "EXECUTION_CONTROL_BASE_URL"
	| "EXECUTION_CONTROL_PRIVATE"
	| "EXECUTION_CONTROL_PRIVATE_ORIGIN"
	| "EXECUTION_CONTROL_SHARED_SECRET"
	| "EXECUTION_CONTROL_TIMEOUT_MS"
>;

export interface ExecutionControlEmbeddingCompatibilityInput {
	baseUrl: string;
	dimensions: number;
	model: string;
	provider: string;
	role: string;
	timeoutMs: number;
	transport: string;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
}

export interface ExecutionControlEmbeddingCompatibilityResult {
	ok: boolean;
	reason: string;
}

export interface ExecutionControlProviderConfigClient {
	checkEmbeddingCompatibility(
		input: ExecutionControlEmbeddingCompatibilityInput,
	): Promise<ExecutionControlEmbeddingCompatibilityResult>;
}

export function createExecutionControlProviderConfigClient(
	env: ExecutionControlRuntimeEnv,
	input: {
		fetchImplementation?: typeof fetch;
		traceDataProvider?: () => Record<string, unknown>;
	} = {},
): ExecutionControlProviderConfigClient {
	const requestExecutionControl = createExecutionControlRequester(env, {
		fetchImplementation: input.fetchImplementation ?? defaultRuntimeFetch,
		traceDataProvider: input.traceDataProvider ?? (() => ({})),
	});

	return {
		async checkEmbeddingCompatibility(
			compatibilityInput: ExecutionControlEmbeddingCompatibilityInput,
		): Promise<ExecutionControlEmbeddingCompatibilityResult> {
			const parsed = await requestExecutionControl(
				"/internal/provider-config/embedding:check-compatibility",
				{
					body: {
						base_url: compatibilityInput.baseUrl,
						dimensions: compatibilityInput.dimensions,
						model: compatibilityInput.model,
						provider: compatibilityInput.provider,
						role: compatibilityInput.role,
						timeout_ms: compatibilityInput.timeoutMs,
						transport: compatibilityInput.transport,
					},
					expectedStatus: 200,
					method: "POST",
					traceHeaders: compatibilityInput.traceHeaders,
					traceId: compatibilityInput.traceId,
				},
			);
			return parseEmbeddingCompatibilityResult(parsed);
		},
	};
}

function parseEmbeddingCompatibilityResult(
	value: JsonRecord,
): ExecutionControlEmbeddingCompatibilityResult {
	const ok = value.ok;
	if (typeof ok !== "boolean") {
		throw invalidExecutionControlResponse("ok must be a boolean.");
	}
	const reason = value.reason;
	if (reason !== undefined && reason !== null && typeof reason !== "string") {
		throw invalidExecutionControlResponse("reason must be a string.");
	}
	return {
		ok,
		reason: typeof reason === "string" ? reason : "",
	};
}

function invalidExecutionControlResponse(detail: string): ExecutionControlTransportError {
	return new ExecutionControlTransportError({
		code: "execution_control_invalid_response",
		message: `Execution control runtime response violates the contract: ${detail}`,
		retryable: true,
		status: 502,
	});
}
