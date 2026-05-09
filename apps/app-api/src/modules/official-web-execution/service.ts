import { AppApiRouteError } from "../../http";
import type { OfficialWebIngestionExecutionStatus } from "../official-web-command";
import {
	type OfficialWebProjectionProjectorStore,
	type OfficialWebTargetArtifactVerificationSummaryWrite,
	toOfficialWebRunProjectionMaterialization,
	toOfficialWebSiteProjectionMaterialization,
} from "../official-web-projection";

export interface OfficialWebExecutionStatusPayload {
	errorCode?: unknown;
	errorMessage?: unknown;
	executionRef?: unknown;
	status?: unknown;
	targetFieldReviews?: unknown;
	updatedAt?: unknown;
}

export interface OfficialWebExecutionStatusService {
	updateRunExecutionStatus(input: {
		payload: OfficialWebExecutionStatusPayload;
		runId: string;
	}): Promise<{
		run: {
			ingestionExecutionErrorCode: string | null;
			ingestionExecutionErrorMessage: string | null;
			ingestionExecutionRef: string | null;
			ingestionExecutionStatus: OfficialWebIngestionExecutionStatus;
			ingestionExecutionUpdatedAt: string;
			runId: string;
		};
	}>;
}

export interface OfficialWebExecutionStatusServiceDependencies {
	now?: () => Date;
	store: OfficialWebProjectionProjectorStore;
}

const ALLOWED_EXECUTION_STATUSES = new Set<OfficialWebIngestionExecutionStatus>([
	"pending",
	"running",
	"staged",
	"promoted",
	"succeeded",
	"failed",
]);

function normalizeOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRequiredStatus(value: unknown): OfficialWebIngestionExecutionStatus {
	const normalized = normalizeOptionalString(value);
	if (
		!(
			normalized &&
			ALLOWED_EXECUTION_STATUSES.has(normalized as OfficialWebIngestionExecutionStatus)
		)
	) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "status" },
			message: "status must be one of: pending, running, staged, promoted, succeeded, failed.",
			retryable: false,
			status: 422,
		});
	}
	return normalized as OfficialWebIngestionExecutionStatus;
}

function normalizeUpdatedAt(value: unknown, fallbackNow: Date): string {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return fallbackNow.toISOString();
	}

	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.valueOf())) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "updatedAt" },
			message: "updatedAt must be a valid ISO timestamp.",
			retryable: false,
			status: 422,
		});
	}
	return parsed.toISOString();
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function sanitizeIdPart(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeTargetFieldReviews(
	value: unknown,
	input: {
		runId: string;
		updatedAt: string;
	},
): OfficialWebTargetArtifactVerificationSummaryWrite[] {
	if (value == null) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "targetFieldReviews" },
			message: "targetFieldReviews must be an array.",
			retryable: false,
			status: 422,
		});
	}

	return value.map((item, index) => {
		if (!isRecord(item)) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `targetFieldReviews[${index}]` },
				message: "targetFieldReviews entries must be objects.",
				retryable: false,
				status: 422,
			});
		}
		const jobId = normalizeOptionalString(item.jobId);
		const reviewRunId = normalizeOptionalString(item.runId) ?? input.runId;
		const status = normalizeOptionalString(item.status);
		const summary = item.summary;
		if (!(jobId && status && isRecord(summary))) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `targetFieldReviews[${index}]` },
				message: "targetFieldReviews entries require jobId, status, and summary.",
				retryable: false,
				status: 422,
			});
		}
		if (reviewRunId !== input.runId) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `targetFieldReviews[${index}].runId` },
				message: "targetFieldReviews runId must match the callback runId.",
				retryable: false,
				status: 422,
			});
		}
		return {
			canonicalVerification: normalizeBoolean(item.canonicalVerification, false),
			jobId,
			objectVerificationId: normalizeOptionalString(item.objectVerificationId),
			runId: reviewRunId,
			sourceHandoffId: normalizeOptionalString(item.sourceHandoffId),
			status,
			summary,
			summaryId:
				normalizeOptionalString(item.summaryId) ??
				`owtargetsummary_${sanitizeIdPart(jobId)}_${sanitizeIdPart(reviewRunId)}`,
			updatedAt: input.updatedAt,
		};
	});
}

function rankTargetFieldReviewStatus(status: string): number {
	switch (status) {
		case "ready_for_selected_write":
			return 4;
		case "release_gate_required":
			return 3;
		case "selected_write_review_required":
			return 2;
		case "blocked_fields":
			return 1;
		default:
			return 0;
	}
}

function coalesceTargetFieldReviews(
	reviews: OfficialWebTargetArtifactVerificationSummaryWrite[],
): OfficialWebTargetArtifactVerificationSummaryWrite[] {
	if (reviews.length <= 1) {
		return reviews;
	}
	const byJobRun = new Map<string, OfficialWebTargetArtifactVerificationSummaryWrite[]>();
	for (const review of reviews) {
		const key = `${review.jobId}::${review.runId}`;
		const group = byJobRun.get(key);
		if (group) {
			group.push(review);
		} else {
			byJobRun.set(key, [review]);
		}
	}
	return Array.from(byJobRun.values()).map((group) => {
		const [firstReview] = group;
		if (!firstReview) {
			throw new Error("official web target field review group must not be empty");
		}
		if (group.length === 1) {
			return firstReview;
		}
		const sorted = [...group].sort(
			(left, right) =>
				rankTargetFieldReviewStatus(right.status) - rankTargetFieldReviewStatus(left.status),
		);
		const [primary] = sorted;
		if (!primary) {
			throw new Error("official web target field review sort result must not be empty");
		}
		return {
			...primary,
			summary: {
				schemaVersion: "official_web_target_field_review_rollup.v1",
				latestStatus: primary.status,
				candidateCount: group.length,
				candidateKeys: group
					.map((review) => normalizeOptionalString(review.summary.candidateKey))
					.filter((value): value is string => Boolean(value)),
				reviewSummaries: group.map((review) => review.summary),
			},
		};
	});
}

export function buildOfficialWebExecutionStatusService(
	dependencies: OfficialWebExecutionStatusServiceDependencies,
): OfficialWebExecutionStatusService {
	const now = dependencies.now ?? (() => new Date());

	return {
		async updateRunExecutionStatus(input) {
			const status = normalizeRequiredStatus(input.payload.status);
			const updatedAt = normalizeUpdatedAt(input.payload.updatedAt, now());
			const executionRef = normalizeOptionalString(input.payload.executionRef);
			const shouldPersistExecutionError = status === "failed" || status === "staged";
			const errorCode = shouldPersistExecutionError
				? normalizeOptionalString(input.payload.errorCode)
				: null;
			const errorMessage = shouldPersistExecutionError
				? normalizeOptionalString(input.payload.errorMessage)
				: null;
			const targetFieldReviews = coalesceTargetFieldReviews(
				normalizeTargetFieldReviews(input.payload.targetFieldReviews, {
					runId: input.runId,
					updatedAt,
				}),
			);

			const updated = await dependencies.store.updateRunExecutionStatus({
				errorCode,
				errorMessage,
				executionRef,
				runId: input.runId,
				status,
				updatedAt,
			});
			if (!updated) {
				throw new AppApiRouteError({
					code: "run_not_found",
					details: { runId: input.runId },
					message: "Official web run not found.",
					retryable: false,
					status: 404,
				});
			}

			if (
				targetFieldReviews.length > 0 &&
				dependencies.store.upsertTargetArtifactVerificationSummaries
			) {
				await dependencies.store.upsertTargetArtifactVerificationSummaries(targetFieldReviews);
			}

			const run = await dependencies.store.getRunProjectionSource(input.runId);
			if (!run) {
				throw new AppApiRouteError({
					code: "run_not_found",
					details: { runId: input.runId },
					message: "Official web run not found.",
					retryable: false,
					status: 404,
				});
			}

			await dependencies.store.upsertRunProjection(
				toOfficialWebRunProjectionMaterialization({
					execution: run,
					projectedAt: updatedAt,
				}),
			);

			const site = await dependencies.store.getSiteProjectionSource(run.siteId);
			if (site) {
				await dependencies.store.upsertSiteProjection(
					toOfficialWebSiteProjectionMaterialization({
						execution: site,
						projectedAt: updatedAt,
					}),
				);
			}

			return {
				run: {
					ingestionExecutionErrorCode: run.ingestionExecutionErrorCode,
					ingestionExecutionErrorMessage: run.ingestionExecutionErrorMessage,
					ingestionExecutionRef: run.ingestionExecutionRef,
					ingestionExecutionStatus: run.ingestionExecutionStatus,
					ingestionExecutionUpdatedAt: run.ingestionExecutionUpdatedAt ?? updatedAt,
					runId: run.runId,
				},
			};
		},
	};
}
