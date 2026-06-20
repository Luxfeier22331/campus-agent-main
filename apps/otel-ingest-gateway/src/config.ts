export interface OtelIngestGatewayEnv {
	OTEL_INGEST_COLLECTOR_HTTP_ENDPOINT?: string;
	OTEL_INGEST_HOST?: string;
	OTEL_INGEST_MAX_BODY_BYTES?: string;
	OTEL_INGEST_PORT?: string;
	OTEL_INGEST_SHARED_SECRET?: string;
}

export interface OtelIngestGatewayConfig {
	collectorHttpEndpoint: string;
	host: string;
	maxBodyBytes: number;
	port: number;
	sharedSecret: string;
}

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const DEFAULT_PORT = 8000;

export function buildOtelIngestGatewayConfig(env: OtelIngestGatewayEnv): OtelIngestGatewayConfig {
	const sharedSecret = env.OTEL_INGEST_SHARED_SECRET?.trim();
	if (!sharedSecret) {
		throw new Error("OTEL_INGEST_SHARED_SECRET is required");
	}

	const collectorHttpEndpoint = normalizeUrl(env.OTEL_INGEST_COLLECTOR_HTTP_ENDPOINT);
	if (!collectorHttpEndpoint) {
		throw new Error("OTEL_INGEST_COLLECTOR_HTTP_ENDPOINT is required");
	}

	return {
		collectorHttpEndpoint,
		host: env.OTEL_INGEST_HOST?.trim() || DEFAULT_HOST,
		maxBodyBytes: parsePositiveInteger(env.OTEL_INGEST_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
		port: parsePositiveInteger(env.OTEL_INGEST_PORT, DEFAULT_PORT),
		sharedSecret,
	};
}

function normalizeUrl(value: string | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}
	return trimmed.replace(/\/+$/u, "");
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
	if (!value?.trim()) {
		return fallback;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
