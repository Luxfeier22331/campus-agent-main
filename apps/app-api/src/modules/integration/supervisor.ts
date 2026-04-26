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
	mapStatusCodeToErrorCode,
	SupervisorTransportError,
} from "./supervisor-transport";
import type {
	SupervisorExecutionClient,
	SupervisorExecutionInput,
	SupervisorExecutionResponse,
} from "./supervisor-types";

export { parseSupervisorExecutionResponsePayload } from "./supervisor-response";
export { probeSupervisorApiReady, SupervisorTransportError } from "./supervisor-transport";
export type {
	RequestedScope,
	SupervisorContextProjection,
	SupervisorExecutionClient,
	SupervisorExecutionInput,
	SupervisorExecutionObservability,
	SupervisorExecutionResponse,
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

			let parsed: Record<string, unknown> | null = null;
			try {
				parsed = (await response.json()) as Record<string, unknown>;
			} catch {
				if (response.status === 200) {
					throw new SupervisorTransportError({
						code: "supervisor_invalid_response",
						message: "Supervisor returned an invalid JSON response.",
						retryable: true,
						status: 502,
					});
				}
			}

			if (response.status !== 200) {
				const errorBody =
					parsed && typeof parsed.error === "object" && parsed.error ? parsed.error : null;
				throw new SupervisorTransportError({
					code:
						errorBody && typeof (errorBody as { code?: unknown }).code === "string"
							? ((errorBody as { code: string }).code ?? mapStatusCodeToErrorCode(response.status))
							: mapStatusCodeToErrorCode(response.status),
					message:
						errorBody && typeof (errorBody as { message?: unknown }).message === "string"
							? (((errorBody as { message: string }).message as string) ??
								"Supervisor execution request failed.")
							: "Supervisor execution request failed.",
					retryable:
						errorBody && typeof (errorBody as { retryable?: unknown }).retryable === "boolean"
							? (((errorBody as { retryable: boolean }).retryable as boolean) ??
								response.status >= 500)
							: response.status >= 500,
					status: response.status,
				});
			}

			return parseSupervisorExecutionResponsePayload(parsed, payload.traceId);
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

			let parsed: Record<string, unknown> | null = null;
			try {
				parsed = (await response.json()) as Record<string, unknown>;
			} catch {
				parsed = null;
			}
			const errorBody =
				parsed && typeof parsed.error === "object" && parsed.error ? parsed.error : null;
			throw new SupervisorTransportError({
				code:
					errorBody && typeof (errorBody as { code?: unknown }).code === "string"
						? ((errorBody as { code: string }).code ?? mapStatusCodeToErrorCode(response.status))
						: mapStatusCodeToErrorCode(response.status),
				message:
					errorBody && typeof (errorBody as { message?: unknown }).message === "string"
						? (((errorBody as { message: string }).message as string) ??
							"Supervisor execution stream failed.")
						: "Supervisor execution stream failed.",
				retryable:
					errorBody && typeof (errorBody as { retryable?: unknown }).retryable === "boolean"
						? (((errorBody as { retryable: boolean }).retryable as boolean) ??
							response.status >= 500)
						: response.status >= 500,
				status: response.status,
			});
		},
	};
}
