export interface CollectorConfigCheck {
	errors: string[];
	passed: boolean;
}

export function checkCollectorConfig(source: Record<string, unknown>): CollectorConfigCheck {
	const errors: string[] = [];
	for (const key of [
		"OTEL_COLLECTOR_AXIOM_AUTH_HEADER",
		"OTEL_COLLECTOR_AXIOM_EVENTS_DATASET",
		"OTEL_COLLECTOR_AXIOM_METRICS_DATASET",
		"OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT",
		"OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT",
		"OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER",
		"OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION",
	]) {
		if (!String(source[key] ?? "").trim()) {
			errors.push(`${key} is required`);
		}
	}
	const endpoint = String(source.OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT ?? "").trim();
	if (endpoint && !endpoint.endsWith("/api/public/otel")) {
		errors.push("OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT must end with /api/public/otel");
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
	const axiomAuth = String(source.OTEL_COLLECTOR_AXIOM_AUTH_HEADER ?? "").trim();
	if (axiomAuth && !axiomAuth.startsWith("Bearer ") && !axiomAuth.startsWith("Token ")) {
		errors.push("OTEL_COLLECTOR_AXIOM_AUTH_HEADER must be a bearer-style header value");
	}
	const auth = String(source.OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER ?? "").trim();
	if (auth && !auth.startsWith("Basic ")) {
		errors.push("OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER must use Basic auth");
	}
	const version = String(source.OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION ?? "").trim();
	if (version && version !== "4") {
		errors.push("OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION must be 4");
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
		OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION: "4",
		OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT: `${baseUrl}/api/public/otel`,
	};
}
