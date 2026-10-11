import {
	isDeployedEnvironment,
	PROFILE_MEMORY_COMMAND_TIMEOUT_MS,
	resolveEnvironment,
} from "../../config";
import type { JsonRecord } from "./execution-control-runtime-types";

export interface MemoryServiceEnv {
	DEPLOYMENT_ENVIRONMENT?: string;
	MEMORY_SERVICE_PRIVATE?: { fetch: typeof fetch };
	MEMORY_SERVICE_PRIVATE_ORIGIN?: string;
	MEMORY_SERVICE_BASE_URL?: string;
	MEMORY_INTERNAL_SHARED_SECRET?: string;
}
export class MemoryServiceTransportError extends Error {
	readonly code: string;
	readonly status: number;
	readonly retryable: boolean;
	constructor(code: string, status: number, retryable: boolean) {
		super(code);
		this.code = code;
		this.status = status;
		this.retryable = retryable;
		this.name = "MemoryServiceTransportError";
	}
}
export function createMemoryRequester(
	env: MemoryServiceEnv,
	input: { fetchImplementation?: typeof fetch },
) {
	return async (
		path: string,
		options: { body?: JsonRecord; expectedStatus: number; method: "POST"; timeoutMs?: number },
	): Promise<JsonRecord> => {
		if (!(env.MEMORY_SERVICE_BASE_URL && env.MEMORY_INTERNAL_SHARED_SECRET)) {
			throw new MemoryServiceTransportError("personal_memory_unavailable", 503, true);
		}
		const deployed = isDeployedEnvironment(resolveEnvironment(env));
		if (deployed && !env.MEMORY_SERVICE_PRIVATE) {
			throw new MemoryServiceTransportError("personal_memory_unavailable", 503, true);
		}
		if (deployed && !env.MEMORY_SERVICE_PRIVATE_ORIGIN?.trim()) {
			throw new MemoryServiceTransportError("personal_memory_unavailable", 503, true);
		}
		const requester = deployed
			? env.MEMORY_SERVICE_PRIVATE!.fetch.bind(env.MEMORY_SERVICE_PRIVATE)
			: (input.fetchImplementation ?? fetch);
		let response: Response;
		try {
			response = await requester(
				`${(deployed ? env.MEMORY_SERVICE_PRIVATE_ORIGIN! : env.MEMORY_SERVICE_BASE_URL).replace(/\/$/u, "")}${path}`,
				{
					method: options.method,
					body: JSON.stringify(options.body ?? {}),
					redirect: "manual",
					headers: {
						"content-type": "application/json",
						"x-memory-origin-auth": env.MEMORY_INTERNAL_SHARED_SECRET,
					},
					signal: AbortSignal.timeout(options.timeoutMs ?? PROFILE_MEMORY_COMMAND_TIMEOUT_MS),
				},
			);
		} catch {
			throw new MemoryServiceTransportError("personal_memory_unavailable", 503, true);
		}
		if (response.status !== options.expectedStatus) {
			const value = (await response.json().catch(() => null)) as {
				error?: { code?: string };
			} | null;
			throw new MemoryServiceTransportError(
				value?.error?.code ?? "personal_memory_unavailable",
				response.status,
				response.status >= 500,
			);
		}
		return (await response.json()) as JsonRecord;
	};
}
