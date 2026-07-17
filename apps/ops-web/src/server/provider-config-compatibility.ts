import type { ProviderConfigCompatibilityClient } from "./provider-config-service.ts";

export interface ProviderConfigCompatibilityEnv {
	OPS_WEB_EXECUTION_CONTROL_URL?: string;
	OPS_WEB_EXECUTION_CONTROL_WORKER_SHARED_SECRET?: string;
}

export function createProviderConfigCompatibilityClient(
	env: ProviderConfigCompatibilityEnv,
): ProviderConfigCompatibilityClient {
	const baseUrl = env.OPS_WEB_EXECUTION_CONTROL_URL?.trim().replace(/\/+$/u, "");
	const secret = env.OPS_WEB_EXECUTION_CONTROL_WORKER_SHARED_SECRET?.trim();
	return {
		async check(input) {
			if (!(baseUrl && secret)) {
				throw new Error("provider compatibility service is not configured");
			}
			const response = await fetch(
				`${baseUrl}/internal/provider-config/embedding:check-compatibility`,
				{
					body: JSON.stringify({
						base_url: input.baseUrl,
						dimensions: input.dimensions,
						model: input.model,
						provider: input.provider,
						role: input.role,
						timeout_ms: input.timeoutMs,
						transport: input.transport,
					}),
					headers: { "content-type": "application/json", "x-worker-origin-auth": secret },
					method: "POST",
					signal: AbortSignal.timeout(Math.min(input.timeoutMs + 2_000, 60_000)),
				},
			);
			const payload = (await response.json()) as { ok?: unknown; reason?: unknown };
			if (!response.ok || typeof payload.ok !== "boolean") {
				throw new Error(`provider compatibility service returned HTTP ${response.status}`);
			}
			return { ok: payload.ok, reason: typeof payload.reason === "string" ? payload.reason : "" };
		},
	};
}
