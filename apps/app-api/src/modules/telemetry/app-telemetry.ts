import * as Sentry from "@sentry/cloudflare";

import { type Env, resolveEnvironment } from "../../config";
import { isStageTimingField, stageTimingBudgetState } from "../latency-budget";
import {
	hashIdentifier,
	normalizeString,
	readTelemetryTraceDataWithoutRequestFailure,
	runTelemetryAsyncSideEffectWithoutRequestFailure,
	runTelemetrySideEffectWithoutRequestFailure,
	toSourceDocIdsSummary,
	toTargetsSummary,
} from "./helpers";
import { createOtlpRuntimeEventSink } from "./otlp";
import type { RuntimeEventSink } from "./runtime-event";
import { buildRuntimeEventEnvelope } from "./runtime-event-envelope";
import { applyRequestContext, applyRequestTags } from "./sentry-scope";
import { resolveTracePropagationHeaders, type TraceDataLike } from "./trace";
import type { AppTelemetry } from "./types";

async function emitStageTimingEvents(input: {
	errorCode: string | null;
	principalType?: string | null;
	requestId: string;
	requestedTool: string | null;
	runtimeEventSink: RuntimeEventSink;
	selectedTool: string | null;
	stageTiming?: Record<string, unknown> | null;
	status: string;
	surface: string;
	telemetryMetadata: Parameters<typeof buildRuntimeEventEnvelope>[1];
	traceId: string;
}): Promise<void> {
	for (const [stageField, durationMs] of Object.entries(input.stageTiming ?? {})) {
		if (
			!(
				isStageTimingField(stageField) &&
				typeof durationMs === "number" &&
				Number.isFinite(durationMs) &&
				durationMs >= 0
			)
		) {
			continue;
		}
		await input.runtimeEventSink.emit({
			duration_ms: durationMs,
			stage_field: stageField,
			budget_state: stageTimingBudgetState(stageField, durationMs),
			...buildRuntimeEventEnvelope(
				{
					errorCode: input.errorCode,
					eventType: "request.stage_timing",
					principalType: input.principalType,
					requestId: input.requestId,
					requestedTool: input.requestedTool,
					selectedTool: input.selectedTool,
					status: input.status,
					surface: input.surface,
					traceId: input.traceId,
				},
				input.telemetryMetadata,
			),
		});
	}
}

export function createAppTelemetry(
	env: Pick<
		Env,
		| "APP_API_ENVIRONMENT"
		| "APP_API_NAME"
		| "APP_API_OTEL_INGEST_ENDPOINT"
		| "APP_API_OTEL_INGEST_SHARED_SECRET"
		| "SENTRY_ENVIRONMENT"
		| "SENTRY_RELEASE"
	>,
	input: {
		runtimeEventSink?: RuntimeEventSink;
		now?: () => Date;
		traceDataProvider?: () => TraceDataLike | null | undefined;
	} = {},
): AppTelemetry {
	const runtimeEventSink = input.runtimeEventSink ?? createOtlpRuntimeEventSink(env);
	const now = input.now ?? (() => new Date());
	const traceDataProvider = input.traceDataProvider ?? (() => Sentry.getTraceData());
	const telemetryMetadata = {
		environment: normalizeString(env.SENTRY_ENVIRONMENT) ?? resolveEnvironment(env),
		now,
		release: normalizeString(env.SENTRY_RELEASE),
	};

	return {
		captureException(error, detail) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				Sentry.withScope((scope) => {
					if (detail?.route) {
						scope.setTag("route", detail.route);
					}
					if (detail?.status) {
						scope.setTag("status", String(detail.status));
					}
					if (detail?.surface) {
						scope.setTag("surface", detail.surface);
					}
					if (detail?.traceId) {
						scope.setTag("trace_id", detail.traceId);
					}

					Sentry.captureException(error);
				});
			});
		},

		configureChatRequestScope(input) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				applyRequestTags({
					principalType: input.actor.principalType,
					requestedTool: input.requestedTool,
					status: "accepted",
					surface: input.surface,
					traceId: input.traceId,
				});
				applyRequestContext({
					conversationId: input.conversationId,
					requestId: input.requestId,
					safetyIdentifier: input.safetyIdentifier,
				});
				Sentry.setContext("actor", {
					actor_id_hash: hashIdentifier(input.actor.subject),
					principal_type: input.actor.principalType,
				});
			});
		},

		configureHttpRequestScope(input) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				applyRequestTags({
					route: input.route,
					surface: input.surface,
					traceId: input.traceId,
				});
			});
		},

		getTraceHeaders(input) {
			return resolveTracePropagationHeaders({
				request: input?.request,
				traceData: readTelemetryTraceDataWithoutRequestFailure(traceDataProvider),
			});
		},

		markHttpResponseStatus(status) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				Sentry.setTag("status", String(status));
			});
		},

		async recordIdentityEndpoint(input) {
			await runTelemetryAsyncSideEffectWithoutRequestFailure(() =>
				runtimeEventSink.emit({
					correlation_id: input.correlationId,
					endpoint: input.endpoint,
					...buildRuntimeEventEnvelope(
						{
							errorCode: input.errorCode,
							eventType: "identity.endpoint",
							principalType: input.principalType,
							status: String(input.status),
							surface: input.surface,
							traceId: input.correlationId,
						},
						telemetryMetadata,
					),
				}),
			);
		},

		async recordRequestAccepted(input) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				applyRequestTags({
					principalType: input.actor.principalType,
					requestedTool: input.requestedTool,
					status: input.status,
					surface: input.surface,
					traceId: input.traceId,
				});
				applyRequestContext({
					conversationId: input.conversationId,
					requestId: input.requestId,
					safetyIdentifier: input.safetyIdentifier,
				});
			});

			await runTelemetryAsyncSideEffectWithoutRequestFailure(() =>
				runtimeEventSink.emit({
					actor_id_hash: hashIdentifier(input.actor.subject),
					conversation_id: input.conversationId,
					safety_identifier: input.safetyIdentifier ?? null,
					...buildRuntimeEventEnvelope(
						{
							eventType: "request.accepted",
							principalType: input.actor.principalType,
							requestId: input.requestId,
							requestedTool: input.requestedTool,
							status: input.status,
							surface: input.surface,
							traceId: input.traceId,
						},
						telemetryMetadata,
					),
				}),
			);
		},

		async recordRequestFinalized(input) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				applyRequestTags({
					errorCode: input.errorCode,
					principalType: input.principalType,
					requestedTool: input.requestedTool,
					resolvedTargets: input.resolvedTargets,
					selectedTool: input.selectedTool,
					status: input.status,
					surface: input.surface,
					traceId: input.traceId,
				});
				applyRequestContext({
					conversationId: input.conversationId,
					requestId: input.requestId,
					resolvedTargets: input.resolvedTargets,
					safetyIdentifier: input.safetyIdentifier,
					selectedTool: input.selectedTool,
				});
			});

			await runTelemetryAsyncSideEffectWithoutRequestFailure(() =>
				runtimeEventSink.emit({
					conversation_id: input.conversationId,
					duration_ms: input.durationMs,
					resolved_targets_count: input.resolvedTargets?.length ?? 0,
					resolved_targets_summary: toTargetsSummary(input.resolvedTargets),
					retryable: input.retryable,
					safety_identifier: input.safetyIdentifier ?? null,
					source_doc_ids_count: input.sourceDocIds.length,
					source_doc_ids_summary: toSourceDocIdsSummary(input.sourceDocIds),
					...buildRuntimeEventEnvelope(
						{
							errorCode: input.errorCode,
							eventType: "request.finalized",
							principalType: input.principalType,
							requestId: input.requestId,
							requestedTool: input.requestedTool,
							selectedTool: input.selectedTool,
							status: input.status,
							surface: input.surface,
							traceId: input.traceId,
						},
						telemetryMetadata,
					),
				}),
			);
			await runTelemetryAsyncSideEffectWithoutRequestFailure(() =>
				emitStageTimingEvents({
					errorCode: input.errorCode,
					principalType: input.principalType,
					requestId: input.requestId,
					requestedTool: input.requestedTool,
					runtimeEventSink,
					selectedTool: input.selectedTool,
					stageTiming: input.stageTiming,
					status: input.status,
					surface: input.surface,
					telemetryMetadata,
					traceId: input.traceId,
				}),
			);
		},

		async recordRequestTransportError(input) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				applyRequestTags({
					errorCode: input.errorCode,
					principalType: input.principalType,
					requestedTool: input.requestedTool,
					status: "error",
					surface: input.surface,
					traceId: input.traceId,
				});
				applyRequestContext({
					conversationId: input.conversationId,
					requestId: input.requestId,
					safetyIdentifier: input.safetyIdentifier,
				});
			});

			await runTelemetryAsyncSideEffectWithoutRequestFailure(() =>
				runtimeEventSink.emit({
					conversation_id: input.conversationId,
					retryable: input.retryable,
					safety_identifier: input.safetyIdentifier ?? null,
					...buildRuntimeEventEnvelope(
						{
							errorCode: input.errorCode,
							eventType: "request.transport_error",
							principalType: input.principalType,
							requestId: input.requestId,
							requestedTool: input.requestedTool,
							status: "error",
							surface: input.surface,
							traceId: input.traceId,
						},
						telemetryMetadata,
					),
				}),
			);
		},

		async recordWebPerformance(input) {
			await runTelemetryAsyncSideEffectWithoutRequestFailure(() =>
				runtimeEventSink.emit({
					metric_name: input.metricName,
					metric_value: input.value,
					navigation_type: input.navigationType,
					rating: input.rating,
					route_group: input.routeGroup,
					...buildRuntimeEventEnvelope(
						{
							eventType: "web.performance",
							status: "observed",
							surface: "campus_web",
						},
						telemetryMetadata,
					),
				}),
			);
		},
	};
}
