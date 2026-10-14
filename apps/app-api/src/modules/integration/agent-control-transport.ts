import { isDeployedEnvironment, resolveEnvironment } from "../../config";
import { type ClusterPrivateEnv, resolveClusterPrivateUpstream } from "./cluster-private-transport";

export const AGENT_CONTROL_FAILURE_MESSAGE = "Agent-control request failed.";

export class AgentControlTransportError extends Error {
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
		this.name = "AgentControlTransportError";
		this.code = input.code;
		this.retryable = input.retryable;
		this.status = input.status;
	}
}
export function assertAgentControlResponseNotRedirect(response: Response): void {
	if (response.status < 300 || response.status >= 400) {
		return;
	}
	throw new AgentControlTransportError({
		code: "agent_control_invalid_response",
		message:
			"Agent Control returned a redirect, which is not permitted for authenticated internal requests.",
		retryable: false,
		status: 502,
	});
}

export async function parseAgentControlJsonResponse(
	response: Response,
): Promise<Record<string, unknown>> {
	try {
		const parsed = (await response.json()) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("Agent Control JSON response must be an object.");
		}
		return parsed as Record<string, unknown>;
	} catch {
		throw new AgentControlTransportError({
			code: "agent_control_invalid_response",
			message: "Agent Control returned an invalid JSON response.",
			retryable: true,
			status: response.status === 200 || response.status === 202 ? 502 : response.status,
		});
	}
}

export function parseAgentControlErrorEnvelope(
	parsed: Record<string, unknown>,
	status: number,
): { code: string; message: string; retryable: boolean } {
	const error = parsed.error;
	if (!error || typeof error !== "object" || Array.isArray(error)) {
		throw new AgentControlTransportError({
			code: "agent_control_invalid_error_envelope",
			message: "Agent Control returned an invalid error envelope.",
			retryable: false,
			status,
		});
	}
	const record = error as Record<string, unknown>;
	if (
		typeof record.code !== "string" ||
		record.code.trim() === "" ||
		!isSafeAgentControlErrorCode(record.code) ||
		typeof record.message !== "string" ||
		record.message.trim() === "" ||
		typeof record.retryable !== "boolean"
	) {
		throw new AgentControlTransportError({
			code: "agent_control_invalid_error_envelope",
			message: "Agent Control returned an invalid error envelope.",
			retryable: false,
			status,
		});
	}
	return {
		code: record.code.trim(),
		message: AGENT_CONTROL_FAILURE_MESSAGE,
		retryable: record.retryable,
	};
}

export function isSafeAgentControlErrorCode(value: string): boolean {
	return /^[A-Za-z0-9_.:-]{1,80}$/u.test(value.trim());
}

export interface AgentControlUpstream {
	baseUrl: string;
	fetch: typeof fetch;
}

export function selectAgentControlFetchImplementation(
	env: Pick<ClusterPrivateEnv, "DEPLOYMENT_ENVIRONMENT">,
	upstream: AgentControlUpstream,
	override?: typeof fetch,
): typeof fetch {
	if (isDeployedEnvironment(resolveEnvironment(env))) {
		return upstream.fetch;
	}
	return override ?? upstream.fetch;
}

export function resolveAgentControlUpstream(env: ClusterPrivateEnv): AgentControlUpstream {
	try {
		return resolveClusterPrivateUpstream(env, "control");
	} catch {
		throw new AgentControlTransportError({
			code: "dependency_not_ready",
			message: "Cluster private ingress is not configured.",
			retryable: true,
			status: 503,
		});
	}
}
