import { type Resource, resourceFromAttributes } from "@opentelemetry/resources";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";

type Span = Parameters<SpanProcessor["onStart"]>[0];
type Context = Parameters<SpanProcessor["onStart"]>[1];
type Attributes = ReadableSpan["attributes"];
type SafeAttributeValue =
	| string
	| number
	| boolean
	| Array<null | undefined | string>
	| Array<null | undefined | number>
	| Array<null | undefined | boolean>;

// This is the producer-side boundary for Agent Runtime traces. Keep only the
// fields emitted by the current Agent/OpenInference and Langfuse integrations.
// Product state and Temporal orchestration belong to their durable stores.
const SAFE_ATTRIBUTE_KEYS = new Set([
	"exception.type",
	"langfuse.environment",
	"langfuse.release",
	"langfuse.trace.name",
	"langfuse.trace.tags",
	"session.id",
	"tool.name",
	"user.id",
	"llm.model_name",
	"llm.provider",
	"llm.system",
	"llm.token_count.completion",
	"llm.token_count.completion_details.reasoning",
	"llm.token_count.prompt",
	"llm.token_count.prompt_details.cache_read",
	"llm.token_count.total",
	"openinference.span.kind",
]);

const SAFE_LANGFUSE_METADATA_KEYS = new Set(["request_id"]);
const LANGFUSE_APP_ROOT_ATTRIBUTE = "langfuse.internal.is_app_root";

const SAFE_RESOURCE_KEYS = new Set([
	"service.name",
	"service.namespace",
	"service.version",
	"deployment.environment",
	"telemetry.sdk.language",
	"telemetry.sdk.name",
	"telemetry.sdk.version",
]);

/**
 * Sanitizes exception-bearing spans at the last shared in-process boundary.
 * Agent instrumentation can record useful error status, but exporter payloads
 * must not contain arbitrary exception text or stack traces.
 */
export function createSafeSpanProcessor(delegate: SpanProcessor): SpanProcessor {
	return new SafeSpanProcessor(delegate);
}

class SafeSpanProcessor implements SpanProcessor {
	readonly #delegate: SpanProcessor;

	constructor(delegate: SpanProcessor) {
		this.#delegate = delegate;
	}

	forceFlush(): Promise<void> {
		return this.#delegate.forceFlush();
	}

	onStart(span: Span, parentContext: Context): void {
		this.#delegate.onStart(span, parentContext);
	}

	onEnd(span: ReadableSpan): void {
		this.#delegate.onEnd(sanitizeReadableSpan(span));
	}

	shutdown(): Promise<void> {
		return this.#delegate.shutdown();
	}
}

function sanitizeReadableSpan(span: ReadableSpan): ReadableSpan {
	const events = span.events
		.filter((event) => event.name === "exception")
		.map((event) => ({
			name: "exception",
			time: event.time,
			attributes: sanitizeExceptionAttributes(event.attributes),
		}));
	const status = { ...span.status, message: "" };
	return {
		attributes: sanitizeAttributes(span.attributes),
		droppedAttributesCount: span.droppedAttributesCount,
		droppedEventsCount: span.droppedEventsCount,
		droppedLinksCount: span.droppedLinksCount,
		duration: span.duration,
		ended: span.ended,
		endTime: span.endTime,
		events,
		instrumentationScope: {
			name: span.instrumentationScope.name,
			...(span.instrumentationScope.version ? { version: span.instrumentationScope.version } : {}),
		},
		kind: span.kind,
		links: [],
		name: boundedSpanName(span.name),
		...(span.parentSpanContext ? { parentSpanContext: span.parentSpanContext } : {}),
		resource: sanitizeResource(span.resource),
		spanContext: () => span.spanContext(),
		startTime: span.startTime,
		status,
	};
}

function sanitizeExceptionAttributes(attributes: Attributes | undefined): Attributes {
	if (!attributes) {
		return {};
	}
	const sanitized: Attributes = {};
	for (const key of ["exception.type", "exception.escaped"] as const) {
		if (key in attributes) {
			const value = safeAttributeValue(key, attributes[key]);
			if (value !== undefined) {
				sanitized[key] = value;
			}
		}
	}
	return sanitized;
}

function sanitizeAttributes(attributes: Attributes): Attributes {
	const sanitized: Attributes = {};
	for (const [key, value] of Object.entries(attributes)) {
		if (key === LANGFUSE_APP_ROOT_ATTRIBUTE) {
			if (value === true) {
				sanitized[key] = true;
			}
			continue;
		}
		if (
			!(
				SAFE_ATTRIBUTE_KEYS.has(key) ||
				(key.startsWith("langfuse.trace.metadata.") &&
					SAFE_LANGFUSE_METADATA_KEYS.has(key.slice("langfuse.trace.metadata.".length)))
			)
		) {
			continue;
		}
		const safeValue = safeAttributeValue(key, value);
		if (safeValue !== undefined) {
			sanitized[key] = safeValue;
		}
	}
	return sanitized;
}

function sanitizeResource(resource: Resource): Resource {
	const attributes: Attributes = {};
	for (const [key, value] of Object.entries(resource.attributes)) {
		if (!SAFE_RESOURCE_KEYS.has(key)) {
			continue;
		}
		const safeValue = safeAttributeValue(key, value);
		if (safeValue !== undefined) {
			attributes[key] = safeValue;
		}
	}
	return resourceFromAttributes(attributes);
}

function safeAttributeValue(key: string, value: unknown): SafeAttributeValue | undefined {
	if (typeof value === "string") {
		return boundedAttributeString(value, key);
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value === "boolean") {
		return value;
	}
	if (!Array.isArray(value) || value.length > 64) {
		return;
	}
	const firstValue = value.find((item) => item !== null && item !== undefined);
	if (firstValue === undefined) {
		return value as Array<null | undefined>;
	}
	const valueType = typeof firstValue;
	if (valueType !== "string" && valueType !== "number" && valueType !== "boolean") {
		return;
	}
	const values: Array<null | undefined | string | number | boolean> = [];
	for (const item of value) {
		if (item === null || item === undefined) {
			values.push(item);
			continue;
		}
		if (typeof item !== valueType) {
			return;
		}
		if (typeof item === "string") {
			const bounded = boundedAttributeString(item, key);
			if (bounded === undefined) {
				return;
			}
			values.push(bounded);
			continue;
		}
		if (typeof item === "number" && Number.isFinite(item)) {
			values.push(item);
			continue;
		}
		if (typeof item === "boolean") {
			values.push(item);
			continue;
		}
		return;
	}
	return values as SafeAttributeValue;
}

function boundedAttributeString(value: string, _key: string): string | undefined {
	const normalized = value.trim();
	if (
		!normalized ||
		normalized.length > 256 ||
		[...normalized].some(
			(character) => character === "\n" || character === "\r" || character === "\u0000",
		)
	) {
		return;
	}
	return normalized;
}

function boundedSpanName(value: string): string {
	return boundedAttributeString(value, "span.name") ?? "runtime.span";
}
