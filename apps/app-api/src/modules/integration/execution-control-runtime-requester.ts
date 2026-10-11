import { EXECUTION_CONTROL_TIMEOUT_MS } from "../../config";
import { createClusterPrivateHeaders } from "./cluster-private-transport";
import type { ExecutionControlRuntimeEnv, JsonRecord } from "./execution-control-runtime-types";
import {
	assertExecutionControlResponseNotRedirect,
	ExecutionControlTransportError,
	parseExecutionControlErrorEnvelope,
	parseExecutionControlJsonResponse,
	resolveExecutionControlUpstream,
	selectExecutionControlFetchImplementation,
} from "./execution-control-transport";

export const defaultRuntimeFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function createExecutionControlRequester(
	env: ExecutionControlRuntimeEnv,
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
	return async function requestExecutionControl(
		path: string,
		options: {
			body?: JsonRecord;
			expectedStatus: number;
			method: "GET" | "POST";
			signal?: AbortSignal;
			timeoutMs?: number;
		},
	): Promise<JsonRecord> {
		const upstream = resolveExecutionControlUpstream(env);
		const fetchImplementation = selectExecutionControlFetchImplementation(
			env,
			upstream,
			input.fetchImplementation,
		);

		const timeoutMs = options.timeoutMs ?? EXECUTION_CONTROL_TIMEOUT_MS;
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
							new ExecutionControlTransportError({
								code: "execution_timeout",
								message: `Execution control runtime request exceeded ${timeoutMs}ms timeout.`,
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
			if (error instanceof ExecutionControlTransportError) {
				throw error;
			}
			if (error instanceof Error && error.name === "AbortError") {
				throw error;
			}

			throw new ExecutionControlTransportError({
				code: "execution_control_unavailable",
				message: "Execution control runtime request failed.",
				retryable: true,
				status: 502,
			});
		}
		assertExecutionControlResponseNotRedirect(response);

		const parsed = await parseExecutionControlJsonResponse(response);
		if (response.status !== options.expectedStatus) {
			const errorEnvelope = parseExecutionControlErrorEnvelope(parsed, response.status);
			throw new ExecutionControlTransportError({
				code: errorEnvelope.code,
				message: errorEnvelope.message,
				retryable: errorEnvelope.retryable,
				status: response.status,
			});
		}
		return parsed;
	};
}
