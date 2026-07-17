import * as Sentry from "@sentry/cloudflare";

import { type Env, resolveEnvironment } from "../../config";
import { isStageTimingField, stageTimingBudgetState } from "../latency-budget";
import { createConsoleRuntimeEventSink } from "./console";
import {
	hashIdentifier,
	normalizeString,
	readTelemetryTraceDataWithoutRequestFailure,
	runTelemetryAsyncSideEffectWithoutRequestFailure,
	runTelemetrySideEffectWithoutRequestFailure,
} from "./helpers";
import type { RuntimeEventSink } from "./runtime-event";
import { buildRuntimeEventEnvelope } from "./runtime-event-envelope";
import { normalizeAppApiRoute } from "./sentry";
import { applyRequestTags } from "./sentry-scope";
import { resolveTracePropagationHeaders, type TraceDataLike } from "./trace";
import type { AppTelemetry } from "./types";

function projectStageTimingFields(
	stageTiming: Record<string, unknown> | null | undefined,
): Record<string, number | string> {
	const output: Record<string, number | string> = {};
	let worstBudgetState: "critical" | "warn" | "within_budget" = "within_budget";
	for (const [stageField, durationMs] of Object.entries(stageTiming ?? {})) {
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
		output[stageField] = durationMs;
		const budgetState = stageTimingBudgetState(stageField, durationMs);
		if (
			budgetState === "critical" ||
			(budgetState === "warn" && worstBudgetState === "within_budget")
		) {
			worstBudgetState = budgetState;
		}
	}
	if (Object.keys(output).length > 0) {
		output.stage_timing_budget_state = worstBudgetState;
	}
	return output;
}

export function createAppTelemetry(
	env: Pick<Env, "APP_API_ENVIRONMENT" | "SENTRY_ENVIRONMENT" | "SENTRY_RELEASE">,
	input: {
		runtimeEventSink?: RuntimeEventSink;
		now?: () => Date;
		traceDataProvider?: () => TraceDataLike | null | undefined;
	} = {},
): AppTelemetry {
	const runtimeEventSink = input.runtimeEventSink ?? createConsoleRuntimeEventSink();
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
						scope.setTag("route", normalizeAppApiRoute(detail.route));
					}
					if (detail?.status) {
						scope.setTag("status", String(detail.status));
					}
					if (detail?.surface) {
						scope.setTag("surface", detail.surface);
					}
					if (detail?.traceId) {
						scope.setTag("correlation_hash", hashIdentifier(detail.traceId));
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

		async recordRequestAccepted(input) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				applyRequestTags({
					principalType: input.actor.principalType,
					requestedTool: input.requestedTool,
					status: input.status,
					surface: input.surface,
					traceId: input.traceId,
				});
			});

			await runTelemetryAsyncSideEffectWithoutRequestFailure(() =>
				runtimeEventSink.emit({
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
			});

			await runTelemetryAsyncSideEffectWithoutRequestFailure(() =>
				runtimeEventSink.emit({
					duration_ms: input.durationMs,
					resolved_targets_count: input.resolvedTargets?.length ?? 0,
					retryable: input.retryable,
					source_doc_ids_count: input.sourceDocIds.length,
					...projectStageTimingFields(input.stageTiming),
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
			});

			await runTelemetryAsyncSideEffectWithoutRequestFailure(() =>
				runtimeEventSink.emit({
					retryable: input.retryable,
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
	};
}
