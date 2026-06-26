import { createHash } from "node:crypto";

import { type Env, isDeployedEnvironment, resolveAppName, resolveEnvironment } from "../../config";
import { defaultRuntimeFetch } from "../integration/execution-control-runtime";
import type { RuntimeEventScalar, RuntimeEventSink } from "./runtime-event";
import { sanitizeRuntimeEventPayload as sanitizeSharedRuntimeEventPayload } from "./runtime-event";

const DEFAULT_OTLP_TIMEOUT_MS = 1_000;
const OTLP_SCOPE_NAME = "campus-agent.app-api.telemetry";

const EVENT_NAME_BY_TYPE = new Map<string, string>([
	["request.accepted", "runtime.request.accepted"],
	["request.finalized", "runtime.request.finalized"],
	["request.transport_error", "runtime.request.transport_error"],
	["projection.enqueued", "runtime.projection.enqueued"],
	["projection.drain", "runtime.projection.drain"],
	["quality.sampled_grade", "runtime.quality.sampled_grade"],
	["identity.endpoint", "runtime.identity.endpoint"],
	["execution.admission_rejected", "runtime.execution.admission_rejected"],
	["execution.cancel_requested", "runtime.execution.cancel_requested"],
	["execution.cancelled", "runtime.execution.cancelled"],
	["execution.runtime_failed", "runtime.execution.runtime_failed"],
	["execution.timed_out", "runtime.execution.timed_out"],
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
			const traceId = otlpTraceId(stringValue(sanitizedPayload.trace_id) ?? eventName);
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
		},
	};
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
