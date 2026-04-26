import { DEFAULT_SUPERVISOR_API_TIMEOUT_MS, type Env, parsePositiveInteger } from "../../config";
import { applyTracePropagationHeaders, resolveTracePropagationHeaders } from "../telemetry/trace";

import type { SupervisorExecutionInput } from "./supervisor-types";

export async function probeSupervisorApiReady(
	env: Pick<
		Env,
		| "SUPERVISOR_API_ACCESS_CLIENT_ID"
		| "SUPERVISOR_API_ACCESS_CLIENT_SECRET"
		| "SUPERVISOR_API_BASE_URL"
		| "SUPERVISOR_API_TIMEOUT_MS"
	>,
	input: {
		fetchImplementation?: typeof fetch;
	} = {},
): Promise<void> {
	const baseUrl = env.SUPERVISOR_API_BASE_URL?.trim();
	if (!baseUrl) {
		throw new SupervisorTransportError({
			code: "dependency_not_ready",
			message: "Supervisor runtime is not configured.",
			retryable: true,
			status: 503,
		});
	}

	const timeoutMs = parsePositiveInteger(
		env.SUPERVISOR_API_TIMEOUT_MS,
		DEFAULT_SUPERVISOR_API_TIMEOUT_MS,
	);
	const fetchImplementation = input.fetchImplementation ?? fetch;

	let response: Response;
	try {
		response = await new Promise<Response>((resolve, reject) => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				controller.abort();
				reject(
					new SupervisorTransportError({
						code: "execution_timeout",
						message: `Supervisor readiness probe exceeded ${timeoutMs}ms timeout.`,
						retryable: true,
						status: 504,
					}),
				);
			}, timeoutMs);

			fetchImplementation(`${baseUrl}/readyz`, {
				headers: createCloudflareAccessServiceTokenHeaders(env),
				method: "GET",
				signal: controller.signal,
			})
				.then(resolve)
				.catch((error) => {
					if (error instanceof Error && error.name === "AbortError") {
						reject(
							new SupervisorTransportError({
								code: "execution_timeout",
								message: `Supervisor readiness probe exceeded ${timeoutMs}ms timeout.`,
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
			message: error instanceof Error ? error.message : "Supervisor readiness probe failed.",
			retryable: true,
			status: 502,
		});
	}

	if (response.status !== 200) {
		throw new SupervisorTransportError({
			code: mapStatusCodeToErrorCode(response.status),
			message: `Supervisor readiness probe returned ${response.status}.`,
			retryable: response.status >= 500,
			status: response.status,
		});
	}
}

export class SupervisorTransportError extends Error {
	readonly code: string;
	readonly retryable: boolean;
	readonly status: number;

	constructor(input: {
		code: string;
		message: string;
		retryable: boolean;
		status: number;
	}) {
		super(input.message);
		this.name = "SupervisorTransportError";
		this.code = input.code;
		this.retryable = input.retryable;
		this.status = input.status;
	}
}

export function mapStatusCodeToErrorCode(status: number): string {
	if (status === 504) {
		return "execution_timeout";
	}

	return "supervisor_unavailable";
}

export function createSupervisorRequestHeaders(input: {
	env: Pick<Env, "SUPERVISOR_API_ACCESS_CLIENT_ID" | "SUPERVISOR_API_ACCESS_CLIENT_SECRET">;
	payload: SupervisorExecutionInput;
	sharedSecret: string;
	traceDataProvider: () => Record<string, unknown>;
	accept?: string;
}): Record<string, string> {
	const headers = new Headers({
		"content-type": "application/json",
		"x-trace-id": input.payload.traceId,
		"x-worker-origin-auth": input.sharedSecret,
	});
	if (input.accept) {
		headers.set("accept", input.accept);
	}
	applyTracePropagationHeaders(
		headers,
		resolveTracePropagationHeaders({
			traceData: input.traceDataProvider(),
		}),
	);
	if (input.payload.traceHeaders) {
		applyTracePropagationHeaders(headers, input.payload.traceHeaders);
	}
	return {
		...Object.fromEntries(headers.entries()),
		...createCloudflareAccessServiceTokenHeaders(input.env),
	};
}

function createCloudflareAccessServiceTokenHeaders(
	env: Pick<Env, "SUPERVISOR_API_ACCESS_CLIENT_ID" | "SUPERVISOR_API_ACCESS_CLIENT_SECRET">,
): Record<string, string> {
	const clientId = env.SUPERVISOR_API_ACCESS_CLIENT_ID?.trim();
	const clientSecret = env.SUPERVISOR_API_ACCESS_CLIENT_SECRET?.trim();
	if (!(clientId && clientSecret)) {
		return {};
	}

	return {
		"CF-Access-Client-Id": clientId,
		"CF-Access-Client-Secret": clientSecret,
	};
}
