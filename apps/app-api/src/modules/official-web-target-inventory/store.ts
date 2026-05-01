import { and, desc, eq, inArray } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDbGetter, type RuntimeDbGetter } from "../../db/runtime";
import {
	crawlRuns,
	officialWebTargetArtifactVerificationSummaries,
	officialWebTargetJobs,
	officialWebTargetPageAttempts,
	pageObservations,
	runArtifacts,
} from "../../db/schema";
import type {
	OfficialWebTargetInventoryFieldStatus,
	OfficialWebTargetInventoryFieldStatusStore,
	OfficialWebTargetInventoryPreviewEvidenceStore,
} from "./service";

function asStagedPromotionDecision(status: string): string {
	return status === "staged" ? "staged" : status;
}

const FIELD_STATUS_VALUES = new Set<OfficialWebTargetInventoryFieldStatus>([
	"ambiguous",
	"missing",
	"not_applicable",
	"present",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function coerceFieldStatus(
	value: unknown,
): Record<string, OfficialWebTargetInventoryFieldStatus> {
	if (!isRecord(value)) {
		return {};
	}
	const result: Record<string, OfficialWebTargetInventoryFieldStatus> = {};
	for (const [fieldName, rawStatus] of Object.entries(value)) {
		if (FIELD_STATUS_VALUES.has(rawStatus as OfficialWebTargetInventoryFieldStatus)) {
			result[fieldName] = rawStatus as OfficialWebTargetInventoryFieldStatus;
		}
	}
	return result;
}

function normalizeOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function summaryMatchesEntrySource(
	summary: unknown,
	sourceUrls: string[],
): boolean {
	if (!isRecord(summary)) {
		return false;
	}
	const normalizedCanonicalUrl = normalizeOptionalString(summary.normalizedCanonicalUrl);
	return !normalizedCanonicalUrl || sourceUrls.includes(normalizedCanonicalUrl);
}

export function createPgOfficialWebTargetInventoryPreviewEvidenceStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): OfficialWebTargetInventoryPreviewEvidenceStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async listPreviewEvidence(input) {
			const db = await getDb();
			const evidence = [];

			for (const entry of input.entries) {
				if (entry.sourceUrls.length === 0) {
					continue;
				}

				const rows = await db
					.select({
						attempt: officialWebTargetPageAttempts,
						observation: pageObservations,
						run: crawlRuns,
					})
					.from(officialWebTargetPageAttempts)
					.innerJoin(crawlRuns, eq(crawlRuns.runId, officialWebTargetPageAttempts.runId))
					.leftJoin(
						pageObservations,
						and(
							eq(pageObservations.runId, officialWebTargetPageAttempts.runId),
							eq(
								pageObservations.normalizedCanonicalUrl,
								officialWebTargetPageAttempts.normalizedCanonicalUrl,
							),
						),
					)
					.where(
						and(
							eq(officialWebTargetPageAttempts.siteId, input.siteId),
							eq(officialWebTargetPageAttempts.targetId, entry.admissionTargetId),
							inArray(officialWebTargetPageAttempts.normalizedCanonicalUrl, entry.sourceUrls),
							eq(officialWebTargetPageAttempts.attemptStatus, "completed"),
						),
					)
					.orderBy(desc(officialWebTargetPageAttempts.attemptedAt))
					.limit(1);

				const row = rows[0];
				if (!row) {
					continue;
				}

				const artifactRows = await db
					.select({ objectKey: runArtifacts.objectKey })
					.from(runArtifacts)
					.where(eq(runArtifacts.runId, row.run.runId))
					.orderBy(runArtifacts.artifactType);

				evidence.push({
					appApiRunId: row.run.runId,
					currentTruthImportWasNull: row.run.ingestionExecutionStatus === "staged",
					ingestionStatus: row.run.ingestionExecutionStatus,
					inventoryId: entry.inventoryId,
					promotionDecision: asStagedPromotionDecision(row.run.ingestionExecutionStatus),
					rawAssetId: row.observation?.rawAssetId ?? "",
					rawVersionId: row.observation?.rawVersionId ?? "",
					sourceObjectKeys: artifactRows.map((artifact) => artifact.objectKey),
					targetAttemptId: row.attempt.attemptId,
					targetJobId: row.attempt.jobId,
				});
			}

			return evidence;
		},
	};
}

export function createPgOfficialWebTargetInventoryFieldStatusStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): OfficialWebTargetInventoryFieldStatusStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async listFieldStatus(input) {
			const db = await getDb();
			const fieldStatusByInventoryId: Record<
				string,
				Record<string, OfficialWebTargetInventoryFieldStatus>
			> = {};

			for (const entry of input.entries) {
				const rows = await db
					.select({
						summary: officialWebTargetArtifactVerificationSummaries,
					})
					.from(officialWebTargetArtifactVerificationSummaries)
					.innerJoin(
						officialWebTargetJobs,
						eq(
							officialWebTargetJobs.jobId,
							officialWebTargetArtifactVerificationSummaries.jobId,
						),
					)
					.where(
						and(
							eq(officialWebTargetJobs.siteId, input.siteId),
							eq(officialWebTargetJobs.targetId, entry.admissionTargetId),
						),
					)
					.orderBy(
						desc(officialWebTargetArtifactVerificationSummaries.updatedAt),
						desc(officialWebTargetArtifactVerificationSummaries.summaryId),
					)
					.limit(10);

				const matched = rows.find((row) =>
					summaryMatchesEntrySource(row.summary.summaryJson, entry.sourceUrls),
				);
				if (!matched) {
					continue;
				}
				const summary = matched.summary.summaryJson;
				if (!isRecord(summary)) {
					continue;
				}
				const fieldStatus = coerceFieldStatus(summary.fieldStatus);
				if (Object.keys(fieldStatus).length > 0) {
					fieldStatusByInventoryId[entry.inventoryId] = fieldStatus;
				}
			}

			return fieldStatusByInventoryId;
		},
	};
}
