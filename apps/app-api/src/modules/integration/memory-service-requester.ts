import {
	isDeployedEnvironment,
	PROFILE_MEMORY_COMMAND_TIMEOUT_MS,
	resolveEnvironment,
} from "../../config";
import type { JsonRecord } from "./agent-control-runtime-types";
import {
	type ClusterPrivateEnv,
	createClusterPrivateHeaders,
	resolveClusterPrivateUpstream,
} from "./cluster-private-transport";

export type MemoryServiceEnv = ClusterPrivateEnv;
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
		let upstream: ReturnType<typeof resolveClusterPrivateUpstream>;
		try {
			upstream = resolveClusterPrivateUpstream(env, "memory");
		} catch {
			throw new MemoryServiceTransportError("personal_memory_unavailable", 503, true);
		}
		const requester = isDeployedEnvironment(resolveEnvironment(env))
			? upstream.fetch
			: (input.fetchImplementation ?? upstream.fetch);
		let response: Response;
		try {
			response = await requester(`${upstream.baseUrl}${path}`, {
				method: options.method,
				body: JSON.stringify(options.body ?? {}),
				redirect: "manual",
				headers: createClusterPrivateHeaders(env),
				signal: AbortSignal.timeout(options.timeoutMs ?? PROFILE_MEMORY_COMMAND_TIMEOUT_MS),
			});
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
