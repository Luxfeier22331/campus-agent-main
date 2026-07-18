export interface CollectorConfigCheck {
	errors: string[];
	passed: boolean;
}

export function checkCollectorConfig(source: Record<string, unknown>): CollectorConfigCheck {
	const errors: string[] = [];
	for (const key of [
		"OTEL_COLLECTOR_AXIOM_INGEST_TOKEN",
		"OTEL_COLLECTOR_AXIOM_LOGS_DATASET",
		"OTEL_COLLECTOR_AXIOM_METRICS_DATASET",
		"OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT",
		"OTEL_COLLECTOR_AXIOM_TRACES_DATASET",
		"OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT",
		"OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER",
	]) {
		if (!String(source[key] ?? "").trim()) {
			errors.push(`${key} is required`);
		}
	}
	for (const key of ["OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT"]) {
		const endpoint = String(source[key] ?? "").trim();
		if (endpoint && !endpoint.endsWith("/api/public/otel")) {
			errors.push(`${key} must end with /api/public/otel`);
		}
	}
	const axiomEndpoint = String(source.OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT ?? "").trim();
	if (
		axiomEndpoint &&
		!(
			(axiomEndpoint.startsWith("https://") || axiomEndpoint.startsWith("http://")) &&
			!axiomEndpoint.replace(/^https?:\/\//u, "").includes("/")
		)
	) {
		errors.push("OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT must be an OTLP base URL without a path");
	}
	for (const key of ["OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER"]) {
		const auth = String(source[key] ?? "").trim();
		if (auth && !auth.startsWith("Basic ")) {
			errors.push(`${key} must use Basic auth`);
		}
	}
	return { errors, passed: errors.length === 0 };
}

export function deriveCollectorEnv(input: {
	baseUrl: string;
	publicKey: string;
	secretKey: string;
}): Record<string, string> {
	const baseUrl = input.baseUrl.trim().replace(/\/+$/u, "");
	return {
		OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER: `Basic ${Buffer.from(
			`${input.publicKey.trim()}:${input.secretKey.trim()}`,
		).toString("base64")}`,
		OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT: `${baseUrl}/api/public/otel`,
	};
}
