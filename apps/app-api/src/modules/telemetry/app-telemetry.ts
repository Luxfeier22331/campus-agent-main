import * as Sentry from "@sentry/cloudflare";

import { type Env, resolveEnvironment } from "../../config";
import { isStageTimingField, stageTimingBudgetState } from "../latency-budget";
import { createConsoleRuntimeEventSink } from "./console";
import {
	normalizeString,
	runTelemetryAsyncSideEffectWithoutRequestFailure,
	runTelemetrySideEffectWithoutRequestFailure,
} from "./helpers";
import type { RuntimeEventSink } from "./runtime-event";
import { buildRuntimeEventEnvelope } from "./runtime-event-envelope";
import { normalizeAppApiRoute } from "./sentry";
import { applyRequestTags } from "./sentry-scope";
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
	env: Pick<Env, "DEPLOYMENT_ENVIRONMENT" | "DEPLOYMENT_RELEASE">,
	input: {
		runtimeEventSink?: RuntimeEventSink;
		now?: () => Date;
	} = {},
): AppTelemetry {
	const runtimeEventSink = input.runtimeEventSink ?? createConsoleRuntimeEventSink();
	const now = input.now ?? (() => new Date());
	const telemetryMetadata = {
		environment: resolveEnvironment(env),
		now,
		release: normalizeString(env.DEPLOYMENT_RELEASE),
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
					if (detail?.requestId) {
						scope.setTag("campus.request_id", detail.requestId);
					}
					if (detail?.traceId) {
						scope.setTag("campus.trace_id", detail.traceId);
					}

					Sentry.captureException(error);
				});
			});
		},

		configureChatRequestScope(input) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				applyRequestTags({
					principalType: input.actor.principalType,
					requestId: input.requestId,
					status: "accepted",
					surface: input.surface,
					traceId: input.traceId,
				});
			});
		},

		configureHttpRequestScope(input) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				applyRequestTags({
					...(input.requestId === undefined ? {} : { requestId: input.requestId }),
					route: input.route,
					surface: input.surface,
					...(input.traceId === undefined ? {} : { traceId: input.traceId }),
				});
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
					requestId: input.requestId,
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
					...(input.principalType === undefined ? {} : { principalType: input.principalType }),
					requestId: input.requestId,
					status: input.status,
					surface: input.surface,
					traceId: input.traceId,
				});
			});

			await runTelemetryAsyncSideEffectWithoutRequestFailure(() =>
				runtimeEventSink.emit({
					cached_input_tokens: input.modelUsage.cachedInputTokens,
					duration_ms: input.durationMs,
					input_tokens: input.modelUsage.inputTokens,
					output_tokens: input.modelUsage.outputTokens,
					retryable: input.retryable,
					source_doc_ids_count: input.sourceDocIds.length,
					total_tokens: input.modelUsage.totalTokens,
					...projectStageTimingFields(input.stageTiming),
					...buildRuntimeEventEnvelope(
						{
							errorCode: input.errorCode,
							eventType: "request.finalized",
							...(input.principalType === undefined ? {} : { principalType: input.principalType }),
							requestId: input.requestId,
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
					...(input.principalType === undefined ? {} : { principalType: input.principalType }),
					requestId: input.requestId,
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
							...(input.principalType === undefined ? {} : { principalType: input.principalType }),
							requestId: input.requestId,
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
