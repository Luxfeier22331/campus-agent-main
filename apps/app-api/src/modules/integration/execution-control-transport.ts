import { type Env, isDeployedEnvironment, resolveEnvironment } from "../../config";

export const EXECUTION_CONTROL_FAILURE_MESSAGE = "Execution-control request failed.";

export class ExecutionControlTransportError extends Error {
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
		this.name = "ExecutionControlTransportError";
		this.code = input.code;
		this.retryable = input.retryable;
		this.status = input.status;
	}
}
export function assertExecutionControlResponseNotRedirect(response: Response): void {
	if (response.status < 300 || response.status >= 400) {
		return;
	}
	throw new ExecutionControlTransportError({
		code: "execution_control_invalid_response",
		message:
			"Execution control returned a redirect, which is not permitted for authenticated internal requests.",
		retryable: false,
		status: 502,
	});
}

export async function parseExecutionControlJsonResponse(
	response: Response,
): Promise<Record<string, unknown>> {
	try {
		const parsed = (await response.json()) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("Execution control JSON response must be an object.");
		}
		return parsed as Record<string, unknown>;
	} catch {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Execution control returned an invalid JSON response.",
			retryable: true,
			status: response.status === 200 || response.status === 202 ? 502 : response.status,
		});
	}
}

export function parseExecutionControlErrorEnvelope(
	parsed: Record<string, unknown>,
	status: number,
): { code: string; message: string; retryable: boolean } {
	const error = parsed.error;
	if (!error || typeof error !== "object" || Array.isArray(error)) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_error_envelope",
			message: "Execution control returned an invalid error envelope.",
			retryable: false,
			status,
		});
	}
	const record = error as Record<string, unknown>;
	if (
		typeof record.code !== "string" ||
		record.code.trim() === "" ||
		!isSafeExecutionControlErrorCode(record.code) ||
		typeof record.message !== "string" ||
		record.message.trim() === "" ||
		typeof record.retryable !== "boolean"
	) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_error_envelope",
			message: "Execution control returned an invalid error envelope.",
			retryable: false,
			status,
		});
	}
	return {
		code: record.code.trim(),
		message: EXECUTION_CONTROL_FAILURE_MESSAGE,
		retryable: record.retryable,
	};
}

export function isSafeExecutionControlErrorCode(value: string): boolean {
	return /^[A-Za-z0-9_.:-]{1,80}$/u.test(value.trim());
}

export function createExecutionControlRequestHeaders(input: {
	sharedSecret: string;
	accept?: string;
}): Record<string, string> {
	const headers = new Headers({
		"content-type": "application/json",
		"x-worker-origin-auth": input.sharedSecret,
	});
	if (input.accept) {
		headers.set("accept", input.accept);
	}
	return Object.fromEntries(headers.entries());
}

export interface ExecutionControlUpstream {
	baseUrl: string;
	fetch: typeof fetch;
}

export function selectExecutionControlFetchImplementation(
	env: Pick<Env, "DEPLOYMENT_ENVIRONMENT">,
	upstream: ExecutionControlUpstream,
	override?: typeof fetch,
): typeof fetch {
	if (isDeployedEnvironment(resolveEnvironment(env))) {
		return upstream.fetch;
	}
	return override ?? upstream.fetch;
}

export function resolveExecutionControlUpstream(
	env: Pick<
		Env,
		| "DEPLOYMENT_ENVIRONMENT"
		| "EXECUTION_CONTROL_BASE_URL"
		| "EXECUTION_CONTROL_PRIVATE"
		| "EXECUTION_CONTROL_PRIVATE_ORIGIN"
	>,
): ExecutionControlUpstream {
	const environment = resolveEnvironment(env);
	const privateFetch = env.EXECUTION_CONTROL_PRIVATE?.fetch;
	if (isDeployedEnvironment(environment)) {
		if (typeof privateFetch !== "function") {
			throw new ExecutionControlTransportError({
				code: "dependency_not_ready",
				message: "Execution control private service binding is not configured.",
				retryable: true,
				status: 503,
			});
		}
		const privateOrigin = env.EXECUTION_CONTROL_PRIVATE_ORIGIN?.trim();
		if (!privateOrigin) {
			throw new ExecutionControlTransportError({
				code: "dependency_not_ready",
				message: "Execution control private service origin is not configured.",
				retryable: true,
				status: 503,
			});
		}
		return {
			baseUrl: privateOrigin.replace(/\/+$/u, ""),
			fetch: privateFetch.bind(env.EXECUTION_CONTROL_PRIVATE) as typeof fetch,
		};
	}

	const baseUrl = env.EXECUTION_CONTROL_BASE_URL?.trim();
	if (!baseUrl) {
		throw new ExecutionControlTransportError({
			code: "dependency_not_ready",
			message: "Execution control is not configured.",
			retryable: true,
			status: 503,
		});
	}
	return {
		baseUrl,
		fetch,
	};
}
