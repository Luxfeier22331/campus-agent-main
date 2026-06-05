import {
	DEFAULT_SUPERVISOR_API_EVAL_TIMEOUT_MS,
	DEFAULT_SUPERVISOR_API_TIMEOUT_MS,
	type Env,
	parsePositiveInteger,
} from "../../config";

import { toSupervisorRequestBody } from "./supervisor-payload";
import { parseSupervisorExecutionResponsePayload } from "./supervisor-response";
import {
	createSupervisorRequestHeaders,
	parseSupervisorErrorEnvelope,
	parseSupervisorJsonResponse,
	SupervisorTransportError,
} from "./supervisor-transport";
import type {
	SupervisorExecutionClient,
	SupervisorExecutionInput,
	SupervisorExecutionResponse,
} from "./supervisor-types";

export {
	createSupervisorDurableRuntimeClient,
	isSupervisorDurableRuntimeConfigured,
	type SupervisorDurableRun,
	type SupervisorDurableRunCancelInput,
	type SupervisorDurableRunCreateInput,
	type SupervisorDurableRunEvent,
	type SupervisorDurableRunEventQuery,
	type SupervisorDurableRunQuery,
	type SupervisorDurableRuntimeClient,
} from "./supervisor-durable";
export { parseSupervisorExecutionResponsePayload } from "./supervisor-response";
export type {
	SupervisorCampusServicesProductPathPreflight,
	SupervisorDurableRuntimePreflight,
	SupervisorReadinessProbeResult,
} from "./supervisor-transport";
export { probeSupervisorApiReady, SupervisorTransportError } from "./supervisor-transport";
export type {
	RequestedScope,
	SupervisorContextProjection,
	SupervisorExecutionClient,
	SupervisorExecutionInput,
	SupervisorExecutionObservability,
	SupervisorExecutionResponse,
	SupervisorExecutionWorkflowTraceSummary,
	SupervisorProfileMemoryItem,
	SupervisorProfileMemorySummary,
	SupervisorPromptTrace,
	SupervisorSessionSlot,
	SupervisorSessionSummary,
} from "./supervisor-types";

export function createSupervisorExecutionClient(
	env: Pick<
		Env,
		| "SUPERVISOR_API_ACCESS_CLIENT_ID"
		| "SUPERVISOR_API_ACCESS_CLIENT_SECRET"
		| "SUPERVISOR_API_BASE_URL"
		| "SUPERVISOR_API_SHARED_SECRET"
		| "SUPERVISOR_API_TIMEOUT_MS"
		| "SUPERVISOR_API_EVAL_TIMEOUT_MS"
	>,
	input: {
		fetchImplementation?: typeof fetch;
		traceDataProvider?: () => Record<string, unknown>;
	} = {},
): SupervisorExecutionClient {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const traceDataProvider = input.traceDataProvider ?? (() => ({}));

	return {
		async execute(payload: SupervisorExecutionInput): Promise<SupervisorExecutionResponse> {
			const baseUrl = env.SUPERVISOR_API_BASE_URL?.trim();
			const sharedSecret = env.SUPERVISOR_API_SHARED_SECRET?.trim();
			const defaultTimeoutMs = parsePositiveInteger(
				env.SUPERVISOR_API_TIMEOUT_MS,
				DEFAULT_SUPERVISOR_API_TIMEOUT_MS,
			);
			const evalTimeoutMs = parsePositiveInteger(
				env.SUPERVISOR_API_EVAL_TIMEOUT_MS,
				DEFAULT_SUPERVISOR_API_EVAL_TIMEOUT_MS,
			);
			const timeoutMs = payload.surface === "eval_benchmark" ? evalTimeoutMs : defaultTimeoutMs;
			if (!(baseUrl && sharedSecret)) {
				throw new SupervisorTransportError({
					code: "dependency_not_ready",
					message: "Supervisor runtime is not configured.",
					retryable: true,
					status: 503,
				});
			}

			let response: Response;
			try {
				response = await new Promise<Response>((resolve, reject) => {
					const controller = new AbortController();
					const timeoutId = setTimeout(() => {
						controller.abort();
						reject(
							new SupervisorTransportError({
								code: "execution_timeout",
								message: `Supervisor execution exceeded ${timeoutMs}ms timeout.`,
								retryable: true,
								status: 504,
							}),
						);
					}, timeoutMs);

					fetchImplementation(`${baseUrl}/api/v1/answer`, {
						method: "POST",
						headers: createSupervisorRequestHeaders({
							env,
							payload,
							sharedSecret,
							traceDataProvider,
						}),
						body: JSON.stringify(toSupervisorRequestBody(payload)),
						signal: controller.signal,
					})
						.then(resolve)
						.catch((error) => {
							if (error instanceof Error && error.name === "AbortError") {
								reject(
									new SupervisorTransportError({
										code: "execution_timeout",
										message: `Supervisor execution exceeded ${timeoutMs}ms timeout.`,
										retryable: true,
										status: 504,
									}),
								);
								return;
							}

							reject(error);
						})
						.finally(() => {
							clearTimeout(timeoutId);
						});
				});
			} catch (error) {
				if (error instanceof SupervisorTransportError) {
					throw error;
				}

				throw new SupervisorTransportError({
					code: "supervisor_unavailable",
					message: error instanceof Error ? error.message : "Supervisor request failed.",
					retryable: true,
					status: 502,
				});
			}

			const parsed = await parseSupervisorJsonResponse(response);

			if (response.status !== 200) {
				const errorEnvelope = parseSupervisorErrorEnvelope(parsed, response.status);
				throw new SupervisorTransportError({
					code: errorEnvelope.code,
					message: errorEnvelope.message,
					retryable: errorEnvelope.retryable,
					status: response.status,
				});
			}

			try {
				return parseSupervisorExecutionResponsePayload(parsed);
			} catch (error) {
				throw new SupervisorTransportError({
					code: "supervisor_invalid_response",
					message:
						error instanceof Error
							? error.message
							: "Supervisor returned a response that violates the execution contract.",
					retryable: true,
					status: 502,
				});
			}
		},
		async executeStream(payload: SupervisorExecutionInput): Promise<Response> {
			const baseUrl = env.SUPERVISOR_API_BASE_URL?.trim();
			const sharedSecret = env.SUPERVISOR_API_SHARED_SECRET?.trim();
			const defaultTimeoutMs = parsePositiveInteger(
				env.SUPERVISOR_API_TIMEOUT_MS,
				DEFAULT_SUPERVISOR_API_TIMEOUT_MS,
			);
			const evalTimeoutMs = parsePositiveInteger(
				env.SUPERVISOR_API_EVAL_TIMEOUT_MS,
				DEFAULT_SUPERVISOR_API_EVAL_TIMEOUT_MS,
			);
			const timeoutMs = payload.surface === "eval_benchmark" ? evalTimeoutMs : defaultTimeoutMs;
			if (!(baseUrl && sharedSecret)) {
				throw new SupervisorTransportError({
					code: "dependency_not_ready",
					message: "Supervisor runtime is not configured.",
					retryable: true,
					status: 503,
				});
			}

			let response: Response;
			try {
				response = await new Promise<Response>((resolve, reject) => {
					const controller = new AbortController();
					const timeoutId = setTimeout(() => {
						controller.abort();
						reject(
							new SupervisorTransportError({
								code: "execution_timeout",
								message: `Supervisor execution stream exceeded ${timeoutMs}ms timeout.`,
								retryable: true,
								status: 504,
							}),
						);
					}, timeoutMs);

					fetchImplementation(`${baseUrl}/api/v1/answer/stream`, {
						method: "POST",
						headers: createSupervisorRequestHeaders({
							accept: "text/event-stream",
							env,
							payload,
							sharedSecret,
							traceDataProvider,
						}),
						body: JSON.stringify(toSupervisorRequestBody(payload)),
						signal: controller.signal,
					})
						.then(resolve)
						.catch((error) => {
							if (error instanceof Error && error.name === "AbortError") {
								reject(
									new SupervisorTransportError({
										code: "execution_timeout",
										message: `Supervisor execution stream exceeded ${timeoutMs}ms timeout.`,
										retryable: true,
										status: 504,
									}),
								);
								return;
							}

							reject(error);
						})
						.finally(() => {
							clearTimeout(timeoutId);
						});
				});
			} catch (error) {
				if (error instanceof SupervisorTransportError) {
					throw error;
				}

				throw new SupervisorTransportError({
					code: "supervisor_unavailable",
					message: error instanceof Error ? error.message : "Supervisor stream request failed.",
					retryable: true,
					status: 502,
				});
			}

			if (response.status === 200) {
				return response;
			}

			const parsed = await parseSupervisorJsonResponse(response);
			const errorEnvelope = parseSupervisorErrorEnvelope(parsed, response.status);
			throw new SupervisorTransportError({
				code: errorEnvelope.code,
				message: errorEnvelope.message,
				retryable: errorEnvelope.retryable,
				status: response.status,
			});
		},
	};
}
