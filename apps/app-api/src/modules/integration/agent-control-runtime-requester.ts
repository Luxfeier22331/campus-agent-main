import { AGENT_CONTROL_TIMEOUT_MS } from "../../config";
import type { AgentControlRuntimeEnv, JsonRecord } from "./agent-control-runtime-types";
import {
	AgentControlTransportError,
	assertAgentControlResponseNotRedirect,
	parseAgentControlErrorEnvelope,
	parseAgentControlJsonResponse,
	resolveAgentControlUpstream,
	selectAgentControlFetchImplementation,
} from "./agent-control-transport";
import { createClusterPrivateHeaders } from "./cluster-private-transport";

export const defaultRuntimeFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function createAgentControlRequester(
	env: AgentControlRuntimeEnv,
	input: {
		fetchImplementation?: typeof fetch;
	},
): (
	path: string,
	options: {
		body?: JsonRecord;
		expectedStatus: number;
		method: "GET" | "POST";
		signal?: AbortSignal;
		timeoutMs?: number;
	},
) => Promise<JsonRecord> {
	return async function requestAgentControl(
		path: string,
		options: {
			body?: JsonRecord;
			expectedStatus: number;
			method: "GET" | "POST";
			signal?: AbortSignal;
			timeoutMs?: number;
		},
	): Promise<JsonRecord> {
		const upstream = resolveAgentControlUpstream(env);
		const fetchImplementation = selectAgentControlFetchImplementation(
			env,
			upstream,
			input.fetchImplementation,
		);

		const timeoutMs = options.timeoutMs ?? AGENT_CONTROL_TIMEOUT_MS;
		let response: Response;
		try {
			let timeoutId: ReturnType<typeof setTimeout> | null = null;
			let removeExternalAbortListener: (() => void) | undefined;
			try {
				response = await new Promise<Response>((resolve, reject) => {
					const controller = new AbortController();
					const rejectExternalAbort = () => {
						controller.abort();
						reject(new DOMException("The operation was aborted.", "AbortError"));
					};
					if (options.signal?.aborted) {
						rejectExternalAbort();
						return;
					}
					if (options.signal) {
						options.signal.addEventListener("abort", rejectExternalAbort, { once: true });
						removeExternalAbortListener = () =>
							options.signal?.removeEventListener("abort", rejectExternalAbort);
					}
					timeoutId = setTimeout(() => {
						controller.abort();
						reject(
							new AgentControlTransportError({
								code: "execution_timeout",
								message: `Agent Control runtime request exceeded ${timeoutMs}ms timeout.`,
								retryable: true,
								status: 504,
							}),
						);
					}, timeoutMs);

					fetchImplementation(`${upstream.baseUrl}${path}`, {
						...(options.body ? { body: JSON.stringify(options.body) } : {}),
						headers: createClusterPrivateHeaders(env),
						method: options.method,
						redirect: "manual",
						signal: controller.signal,
					}).then(resolve, reject);
				});
			} finally {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				removeExternalAbortListener?.();
			}
		} catch (error) {
			if (error instanceof AgentControlTransportError) {
				throw error;
			}
			if (error instanceof Error && error.name === "AbortError") {
				throw error;
			}

			throw new AgentControlTransportError({
				code: "agent_control_unavailable",
				message: "Agent Control runtime request failed.",
				retryable: true,
				status: 502,
			});
		}
		assertAgentControlResponseNotRedirect(response);

		const parsed = await parseAgentControlJsonResponse(response);
		if (response.status !== options.expectedStatus) {
			const errorEnvelope = parseAgentControlErrorEnvelope(parsed, response.status);
			throw new AgentControlTransportError({
				code: errorEnvelope.code,
				message: errorEnvelope.message,
				retryable: errorEnvelope.retryable,
				status: response.status,
			});
		}
		return parsed;
	};
}
