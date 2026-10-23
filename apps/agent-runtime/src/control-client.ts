import { currentActivityMetadata } from "./activity-metadata.ts";
export class ControlHTTPError extends Error {
	readonly status: number;
	readonly code: string;
	readonly retryable: boolean;
	constructor(action: string, status: number, body?: { code?: string; retryable?: boolean }) {
		super(`agent-control ${action} status ${status}`);
		this.status = status;
		this.code = body?.code ?? "runtime_control_failed";
		this.retryable = body?.retryable !== false;
	}
}
export class AgentControlClient {
	readonly baseUrl: string;
	readonly secret: string;
	constructor(baseUrl: string, secret: string) {
		this.baseUrl = baseUrl.replace(/\/$/u, "");
		this.secret = secret;
	}
	async call<T>(action: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
		const response = await fetch(`${this.baseUrl}/internal/agent-runtime/${action}`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-agent-runtime-auth": this.secret },
			body: JSON.stringify({ ...input, activity: currentActivityMetadata() }),
			redirect: "error",
			signal: AbortSignal.any([AbortSignal.timeout(95_000), ...(signal ? [signal] : [])]),
		});
		if (!response.ok) {
			const body = await response.json().catch(() => undefined);
			throw new ControlHTTPError(action, response.status, body);
		}
		return (await response.json()) as T;
	}
	async load<T>(requestId: string, ref: string): Promise<T> {
		const out = await this.call<{ payload: T }>("payload/get", { request_id: requestId, ref });
		return out.payload;
	}
	async maybeLoad<T>(requestId: string, ref: string): Promise<T | undefined> {
		try {
			return await this.load<T>(requestId, ref);
		} catch (error) {
			if (error instanceof ControlHTTPError && error.status === 404) {
				return undefined;
			}
			throw error;
		}
	}
	async save(requestId: string, ref: string, payload: unknown): Promise<void> {
		await this.call("payload/put", { request_id: requestId, ref, payload });
	}
}
