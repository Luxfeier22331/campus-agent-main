import { createHash } from "node:crypto";

import { type Env, isDeployedEnvironment, resolveAppName, resolveEnvironment } from "../../config";
import { defaultRuntimeFetch } from "../integration/execution-control-runtime";
import { isStageTimingField } from "../latency-budget";
import type { RuntimeEventScalar, RuntimeEventSink } from "./runtime-event";
import { sanitizeRuntimeEventPayload as sanitizeSharedRuntimeEventPayload } from "./runtime-event";

const DEFAULT_OTLP_TIMEOUT_MS = 1_000;
const OTLP_SCOPE_NAME = "campus-agent.app-api.telemetry";
const STAGE_DURATION_HISTOGRAM_BOUNDS_MS = [
	100, 250, 500, 1_000, 2_500, 5_000, 10_000, 15_000, 30_000,
];
const WEB_VITAL_METRICS = {
	CLS: { bounds: [0.05, 0.1, 0.25, 0.5, 1], name: "campus.web.cls", unit: "1" },
	FCP: { bounds: [500, 1_000, 1_800, 3_000, 5_000, 10_000], name: "campus.web.fcp_ms", unit: "ms" },
	INP: { bounds: [100, 200, 500, 1_000, 2_500, 5_000], name: "campus.web.inp_ms", unit: "ms" },
	LCP: {
		bounds: [1_000, 2_500, 4_000, 6_000, 10_000, 20_000],
		name: "campus.web.lcp_ms",
		unit: "ms",
	},
	TTFB: { bounds: [200, 500, 800, 1_800, 3_000, 5_000], name: "campus.web.ttfb_ms", unit: "ms" },
} as const;

const EVENT_NAME_BY_TYPE = new Map<string, string>([
	["request.accepted", "runtime.request.accepted"],
	["request.finalized", "runtime.request.finalized"],
	["request.stage_timing", "runtime.request.stage_timing"],
	["request.transport_error", "runtime.request.transport_error"],
	["identity.endpoint", "runtime.identity.endpoint"],
	["web.performance", "runtime.web.performance"],
]);

export interface OtlpRuntimeEventEnv
	extends Pick<
		Env,
		| "APP_API_ENVIRONMENT"
		| "APP_API_NAME"
		| "APP_API_OTEL_INGEST_ENDPOINT"
		| "APP_API_OTEL_INGEST_SHARED_SECRET"
	> {}

export function createOtlpRuntimeEventSink(
	env: OtlpRuntimeEventEnv,
	input: {
		fetchImplementation?: typeof fetch;
		now?: () => Date;
		timeoutMs?: number;
	} = {},
): RuntimeEventSink {
	const environment = resolveEnvironment(env);
	const endpoint = env.APP_API_OTEL_INGEST_ENDPOINT?.trim().replace(/\/+$/u, "");
	const sharedSecret = env.APP_API_OTEL_INGEST_SHARED_SECRET?.trim();
	const fetchImplementation = input.fetchImplementation ?? defaultRuntimeFetch;
	const now = input.now ?? (() => new Date());
	const timeoutMs =
		typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
			? Math.floor(input.timeoutMs)
			: DEFAULT_OTLP_TIMEOUT_MS;

	if (isDeployedEnvironment(environment)) {
		if (!endpoint) {
			throw new Error("APP_API_OTEL_INGEST_ENDPOINT is required for deployed app-api telemetry");
		}
		if (!sharedSecret) {
			throw new Error(
				"APP_API_OTEL_INGEST_SHARED_SECRET is required for deployed app-api telemetry",
			);
		}
	}

	if (!(endpoint && sharedSecret)) {
		return { emit: async () => undefined };
	}

	return {
		async emit(payload) {
			const sanitizedPayload = sanitizeSharedRuntimeEventPayload(payload);
			if (!sanitizedPayload) {
				return;
			}

			const eventName = EVENT_NAME_BY_TYPE.get(String(sanitizedPayload.event_type));
			if (!eventName) {
				return;
			}

			const occurredAt = stringValue(sanitizedPayload.occurred_at) ?? now().toISOString();
			const traceId = otlpTraceId(
				stringValue(sanitizedPayload.trace_id) ?? `${eventName}:${occurredAt}`,
			);
			const spanId = otlpSpanId(
				`${traceId}:${eventName}:${stringValue(sanitizedPayload.request_id) ?? ""}:${occurredAt}`,
			);
			const resourceAttributes = toOtlpAttributes({
				"deployment.environment": environment,
				"service.name": resolveAppName(env),
				"service.namespace": "campus-agent",
				"telemetry.allowed_attributes_version": "runtime-otel-attrs-v1",
			});
			const eventAttributes = toOtlpAttributes(sanitizedPayload);
			const timeUnixNano = unixNano(occurredAt);

			await postOtlp(
				`${endpoint}/v1/traces`,
				{
					resourceSpans: [
						{
							resource: { attributes: resourceAttributes },
							scopeSpans: [
								{
									scope: { name: OTLP_SCOPE_NAME },
									spans: [
										{
											attributes: eventAttributes,
											endTimeUnixNano: timeUnixNano,
											kind: 1,
											name: eventName,
											spanId,
											startTimeUnixNano: timeUnixNano,
											status: { code: statusCodeFor(sanitizedPayload.status) },
											traceId,
										},
									],
								},
							],
						},
					],
				},
				{ fetchImplementation, sharedSecret, timeoutMs },
			);

			await postOtlp(
				`${endpoint}/v1/logs`,
				{
					resourceLogs: [
						{
							resource: { attributes: resourceAttributes },
							scopeLogs: [
								{
									logRecords: [
										{
											attributes: eventAttributes,
											body: { stringValue: eventName },
											severityText: severityFor(sanitizedPayload.status),
											timeUnixNano,
											traceId,
										},
									],
									scope: { name: OTLP_SCOPE_NAME },
								},
							],
						},
					],
				},
				{ fetchImplementation, sharedSecret, timeoutMs },
			);

			const metricPayload =
				buildStageDurationMetricPayload({
					event: sanitizedPayload,
					resourceAttributes,
					timeUnixNano,
				}) ??
				buildWebVitalMetricPayload({
					event: sanitizedPayload,
					resourceAttributes,
					timeUnixNano,
				});
			if (metricPayload) {
				await postOtlp(`${endpoint}/v1/metrics`, metricPayload, {
					fetchImplementation,
					sharedSecret,
					timeoutMs,
				});
			}
		},
	};
}

function buildStageDurationMetricPayload(input: {
	event: Record<string, RuntimeEventScalar>;
	resourceAttributes: ReturnType<typeof toOtlpAttributes>;
	timeUnixNano: string;
}): Record<string, unknown> | null {
	if (input.event.event_type !== "request.stage_timing") {
		return null;
	}
	const stageField = stringValue(input.event.stage_field);
	if (!(stageField && isStageTimingField(stageField))) {
		return null;
	}
	const durationMs = input.event.duration_ms;
	if (!(typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0)) {
		return null;
	}

	return {
		resourceMetrics: [
			{
				resource: { attributes: input.resourceAttributes },
				scopeMetrics: [
					{
						metrics: [
							{
								description:
									"Sanitized app-api online request stage duration emitted with bounded attributes.",
								histogram: {
									aggregationTemporality: "AGGREGATION_TEMPORALITY_DELTA",
									dataPoints: [
										{
											attributes: toOtlpAttributes({
												budget_state: input.event.budget_state,
												selected_tool: input.event.selected_tool,
												stage_field: stageField,
												status: input.event.status,
												surface: input.event.surface,
											}),
											bucketCounts: histogramBucketCounts(
												durationMs,
												STAGE_DURATION_HISTOGRAM_BOUNDS_MS,
											),
											count: "1",
											explicitBounds: STAGE_DURATION_HISTOGRAM_BOUNDS_MS,
											max: durationMs,
											min: durationMs,
											sum: durationMs,
											timeUnixNano: input.timeUnixNano,
										},
									],
								},
								name: "campus.app_api.stage_duration_ms",
								unit: "ms",
							},
						],
						scope: { name: OTLP_SCOPE_NAME },
					},
				],
			},
		],
	};
}

function buildWebVitalMetricPayload(input: {
	event: Record<string, RuntimeEventScalar>;
	resourceAttributes: ReturnType<typeof toOtlpAttributes>;
	timeUnixNano: string;
}): Record<string, unknown> | null {
	if (input.event.event_type !== "web.performance") {
		return null;
	}
	const metricName = stringValue(input.event.metric_name);
	if (!(metricName && metricName in WEB_VITAL_METRICS)) {
		return null;
	}
	const metric = WEB_VITAL_METRICS[metricName as keyof typeof WEB_VITAL_METRICS];
	const value = input.event.metric_value;
	if (!(typeof value === "number" && Number.isFinite(value) && value >= 0)) {
		return null;
	}

	return {
		resourceMetrics: [
			{
				resource: { attributes: input.resourceAttributes },
				scopeMetrics: [
					{
						metrics: [
							{
								description: "Anonymous browser Web Vital with bounded route attributes.",
								histogram: {
									aggregationTemporality: "AGGREGATION_TEMPORALITY_DELTA",
									dataPoints: [
										{
											attributes: toOtlpAttributes({
												navigation_type: input.event.navigation_type,
												rating: input.event.rating,
												route_group: input.event.route_group,
											}),
											bucketCounts: histogramBucketCounts(value, metric.bounds),
											count: "1",
											explicitBounds: metric.bounds,
											max: value,
											min: value,
											sum: value,
											timeUnixNano: input.timeUnixNano,
										},
									],
								},
								name: metric.name,
								unit: metric.unit,
							},
						],
						scope: { name: OTLP_SCOPE_NAME },
					},
				],
			},
		],
	};
}

function histogramBucketCounts(value: number, bounds: readonly number[]): string[] {
	const bucketIndex = bounds.findIndex((bound) => value <= bound);
	const counts = Array.from({ length: bounds.length + 1 }, () => "0");
	counts[bucketIndex === -1 ? counts.length - 1 : bucketIndex] = "1";
	return counts;
}

async function postOtlp(
	url: string,
	body: Record<string, unknown>,
	input: {
		fetchImplementation: typeof fetch;
		sharedSecret: string;
		timeoutMs: number;
	},
): Promise<void> {
	const response = await new Promise<Response>((resolve, reject) => {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			controller.abort();
			reject(new Error(`OTLP ingest timed out after ${input.timeoutMs}ms.`));
		}, input.timeoutMs);

		input
			.fetchImplementation(url, {
				body: JSON.stringify(body),
				headers: {
					authorization: `Bearer ${input.sharedSecret}`,
					"content-type": "application/json",
				},
				method: "POST",
				signal: controller.signal,
			})
			.then(resolve)
			.catch((error) => {
				if (error instanceof Error && error.name === "AbortError") {
					reject(new Error(`OTLP ingest timed out after ${input.timeoutMs}ms.`));
					return;
				}
				reject(error);
			})
			.finally(() => clearTimeout(timeoutId));
	});

	if (!response.ok) {
		throw new Error(`OTLP ingest failed with HTTP ${response.status}.`);
	}
}

function toOtlpAttributes(input: Record<string, RuntimeEventScalar>): Array<{
	key: string;
	value: { boolValue?: boolean; doubleValue?: number; intValue?: string; stringValue?: string };
}> {
	const attributes: Array<{
		key: string;
		value: { boolValue?: boolean; doubleValue?: number; intValue?: string; stringValue?: string };
	}> = [];
	for (const [key, value] of Object.entries(input)) {
		if (value === null) {
			continue;
		}
		if (typeof value === "boolean") {
			attributes.push({ key, value: { boolValue: value } });
			continue;
		}
		if (typeof value === "number") {
			if (Number.isInteger(value)) {
				attributes.push({ key, value: { intValue: String(value) } });
				continue;
			}
			attributes.push({ key, value: { doubleValue: value } });
			continue;
		}
		attributes.push({ key, value: { stringValue: value } });
	}
	return attributes;
}

function otlpTraceId(value: string): string {
	if (/^[0-9a-f]{32}$/u.test(value)) {
		return value;
	}
	return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function otlpSpanId(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function unixNano(iso: string): string {
	const millis = Date.parse(iso);
	const safeMillis = Number.isFinite(millis) ? millis : Date.now();
	return String(BigInt(safeMillis) * 1_000_000n);
}

function stringValue(value: RuntimeEventScalar | undefined): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function statusCodeFor(status: RuntimeEventScalar | undefined): number {
	return status === "error" ? 2 : 1;
}

function severityFor(status: RuntimeEventScalar | undefined): string {
	return status === "error" ? "ERROR" : "INFO";
}

export { sanitizeRuntimeEventPayload } from "./runtime-event";
