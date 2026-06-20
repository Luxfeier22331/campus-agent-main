import * as Sentry from "@sentry/cloudflare";

import { type Env, resolveEnvironment } from "../../config";
import type { AxiomRuntimeEventSink } from "./axiom";
import { buildAxiomEnvelope } from "./axiom-envelope";
import {
	hashIdentifier,
	normalizeString,
	readTelemetryTraceDataWithoutRequestFailure,
	runTelemetrySideEffectWithoutRequestFailure,
	toScopeSummary,
	toSourceDocIdsSummary,
} from "./helpers";
import { createOtlpRuntimeEventSink } from "./otlp";
import { applyRequestContext, applyRequestTags } from "./sentry-scope";
import { resolveTracePropagationHeaders, type TraceDataLike } from "./trace";
import type { AppTelemetry } from "./types";

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
		axiomSink?: AxiomRuntimeEventSink;
		now?: () => Date;
		traceDataProvider?: () => TraceDataLike | null | undefined;
	} = {},
): AppTelemetry {
	const axiomSink = input.axiomSink ?? createOtlpRuntimeEventSink(env);
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
					requestedCapability: input.requestedCapability,
					requestedScope: input.requestedScope,
					status: "accepted",
					surface: input.surface,
					traceId: input.traceId,
				});
				applyRequestContext({
					conversationId: input.conversationId,
					requestId: input.requestId,
					requestedScope: input.requestedScope,
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

		async recordExecutionAuditEvent(input) {
			await axiomSink.emit({
				bridge_duration_ms: input.bridgeDurationMs,
				decision: input.decision,
				duration_ms: input.durationMs,
				failure_kind: input.failureKind,
				http_status: input.httpStatus,
				lane: input.lane,
				queue_wait_ms: input.queueWaitMs,
				retryable: input.retryable,
				...buildAxiomEnvelope(
					{
						eventType: input.eventType,
						requestId: input.requestId,
						requestedCapability: input.requestedCapability,
						status: input.status,
						surface: input.surface,
						traceId: input.traceId,
					},
					telemetryMetadata,
				),
			});
		},

		async recordIdentityEndpoint(input) {
			await axiomSink.emit({
				correlation_id: input.correlationId,
				endpoint: input.endpoint,
				...buildAxiomEnvelope(
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
			});
		},

		async recordProjectionDrain(input) {
			await axiomSink.emit({
				abandoned_count: input.abandoned ?? 0,
				failed_count: input.failed,
				processed_count: input.processed,
				projector_last_error_code: input.projectorLastErrorCode ?? null,
				projector_name: input.projector,
				...buildAxiomEnvelope(
					{
						errorCode: input.projectorLastErrorCode ?? null,
						eventType: "projection.drain",
						surface: input.surface,
					},
					telemetryMetadata,
				),
			});
		},

		async recordProjectionEnqueued(input) {
			await axiomSink.emit({
				conversation_id: input.conversationId,
				projection_stage: input.projectionStage,
				resolved_scope_summary: toScopeSummary(input.resolvedScope),
				safety_identifier: input.safetyIdentifier ?? null,
				...buildAxiomEnvelope(
					{
						eventType: "projection.enqueued",
						principalType: input.principalType,
						requestId: input.requestId,
						requestedCapability: input.requestedCapability,
						requestedScope: input.requestedScope,
						surface: input.surface,
						traceId: input.traceId,
					},
					telemetryMetadata,
				),
			});
		},

		async recordRequestAccepted(input) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				applyRequestTags({
					principalType: input.actor.principalType,
					requestedCapability: input.requestedCapability,
					requestedScope: input.requestedScope,
					status: input.status,
					surface: input.surface,
					traceId: input.traceId,
				});
				applyRequestContext({
					conversationId: input.conversationId,
					requestId: input.requestId,
					requestedScope: input.requestedScope,
					safetyIdentifier: input.safetyIdentifier,
				});
			});

			await axiomSink.emit({
				actor_id_hash: hashIdentifier(input.actor.subject),
				conversation_id: input.conversationId,
				safety_identifier: input.safetyIdentifier ?? null,
				...buildAxiomEnvelope(
					{
						eventType: "request.accepted",
						principalType: input.actor.principalType,
						requestId: input.requestId,
						requestedCapability: input.requestedCapability,
						requestedScope: input.requestedScope,
						status: input.status,
						surface: input.surface,
						traceId: input.traceId,
					},
					telemetryMetadata,
				),
			});
		},

		async recordRequestFinalized(input) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				applyRequestTags({
					errorCode: input.errorCode,
					principalType: input.principalType,
					requestedCapability: input.requestedCapability,
					requestedScope: input.requestedScope,
					selectedCapability: input.selectedCapability,
					status: input.status,
					surface: input.surface,
					traceId: input.traceId,
				});
				applyRequestContext({
					conversationId: input.conversationId,
					requestId: input.requestId,
					requestedScope: input.requestedScope,
					resolvedScope: input.resolvedScope,
					safetyIdentifier: input.safetyIdentifier,
					selectedCapability: input.selectedCapability,
				});
			});

			await axiomSink.emit({
				conversation_id: input.conversationId,
				duration_ms: input.durationMs,
				resolved_scope_summary: toScopeSummary(input.resolvedScope),
				retryable: input.retryable,
				safety_identifier: input.safetyIdentifier ?? null,
				source_doc_ids_count: input.sourceDocIds.length,
				source_doc_ids_summary: toSourceDocIdsSummary(input.sourceDocIds),
				...buildAxiomEnvelope(
					{
						errorCode: input.errorCode,
						eventType: "request.finalized",
						principalType: input.principalType,
						requestId: input.requestId,
						requestedCapability: input.requestedCapability,
						requestedScope: input.requestedScope,
						selectedCapability: input.selectedCapability,
						status: input.status,
						surface: input.surface,
						traceId: input.traceId,
					},
					telemetryMetadata,
				),
			});
		},

		async recordRequestTransportError(input) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				applyRequestTags({
					errorCode: input.errorCode,
					principalType: input.principalType,
					requestedCapability: input.requestedCapability,
					requestedScope: input.requestedScope,
					status: "error",
					surface: input.surface,
					traceId: input.traceId,
				});
				applyRequestContext({
					conversationId: input.conversationId,
					requestId: input.requestId,
					requestedScope: input.requestedScope,
					safetyIdentifier: input.safetyIdentifier,
				});
			});

			await axiomSink.emit({
				conversation_id: input.conversationId,
				retryable: input.retryable,
				safety_identifier: input.safetyIdentifier ?? null,
				...buildAxiomEnvelope(
					{
						errorCode: input.errorCode,
						eventType: "request.transport_error",
						principalType: input.principalType,
						requestId: input.requestId,
						requestedCapability: input.requestedCapability,
						requestedScope: input.requestedScope,
						status: "error",
						surface: input.surface,
						traceId: input.traceId,
					},
					telemetryMetadata,
				),
			});
		},

		async recordQualitySampledGrade(input) {
			await axiomSink.emit({
				collection: input.collection,
				grade_domain: input.gradeDomain,
				grade_id: input.gradeId,
				grade_source: input.gradeSource,
				grader_version: input.graderVersion,
				model_name: input.modelName,
				rationale_summary: input.rationaleSummary,
				request_started_at: input.requestStartedAt,
				sampled_at: input.sampledAt,
				score_milli: input.scoreMilli,
				verdict: input.verdict,
				...buildAxiomEnvelope(
					{
						eventType: "quality.sampled_grade",
						occurredAt: input.sampledAt,
						principalType: input.principalType,
						requestId: input.requestId,
						requestedCapability: input.requestedCapability,
						requestedScopeSummary: input.requestedScopeSummary,
						selectedCapability: input.selectedCapability,
						surface: input.surface,
						traceId: input.traceId,
					},
					telemetryMetadata,
				),
			});
		},
	};
}
