export interface AgentRuntimeServerConfig {
	host: string;
	port: number;
}

export function exactSharedSecret(value: string | undefined): string {
	const sharedSecret = value ?? "";
	if (sharedSecret !== sharedSecret.trim()) {
		throw new Error(
			"EXECUTION_AGENT_RUNTIME_SHARED_SECRET must not contain surrounding whitespace",
		);
	}
	return sharedSecret;
}

export function loadAgentRuntimeServerConfig(
	env: Partial<Pick<NodeJS.ProcessEnv, "HOST" | "PORT">> = process.env,
): AgentRuntimeServerConfig {
	const host = env.HOST?.trim() || "0.0.0.0";
	const rawPort = env.PORT?.trim() || "27062";
	if (!/^\d+$/u.test(rawPort)) {
		throw new Error("PORT must be a positive integer");
	}
	const port = Number(rawPort);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
		throw new Error("PORT must be between 1 and 65535");
	}
	return { host, port };
}
