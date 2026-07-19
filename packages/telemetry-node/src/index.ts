import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { type Resource, resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
	ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_NAMESPACE,
} from "@opentelemetry/semantic-conventions";

export interface NodeTelemetryController {
	configured: boolean;
	resource: Resource;
	spanProcessor: SpanProcessor | null;
	shutdown(): Promise<void>;
}

export function startNodeTelemetry(input: {
	env?: Record<string, string | undefined>;
	serviceName: string;
}): NodeTelemetryController {
	const env = input.env ?? process.env;
	const resource = resourceFromAttributes({
		[ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: env.DEPLOYMENT_ENVIRONMENT?.trim() || "local",
		[ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME?.trim() || input.serviceName,
		[ATTR_SERVICE_NAMESPACE]: "campus-agent",
	});
	const endpoint = traceEndpoint(env);
	if (!endpoint) {
		return {
			configured: false,
			resource,
			spanProcessor: null,
			shutdown: async () => undefined,
		};
	}
	const spanProcessor = new BatchSpanProcessor(
		new OTLPTraceExporter({
			headers: parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
			url: endpoint,
		}),
	);
	const sdk = new NodeSDK({ resource, spanProcessors: [spanProcessor] });
	sdk.start();
	return {
		configured: true,
		resource,
		spanProcessor,
		shutdown: async () => sdk.shutdown(),
	};
}

function traceEndpoint(env: Record<string, string | undefined>): string | null {
	const traces = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
	if (traces) {
		return traces;
	}
	const base = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim().replace(/\/$/u, "");
	return base ? `${base}/v1/traces` : null;
}

function parseHeaders(value: string | undefined): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const entry of value?.split(",") ?? []) {
		const separator = entry.indexOf("=");
		if (separator <= 0) {
			continue;
		}
		const key = entry.slice(0, separator).trim();
		const headerValue = entry.slice(separator + 1).trim();
		if (key && headerValue) {
			headers[key] = headerValue;
		}
	}
	return headers;
}
