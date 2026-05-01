import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
	officialWebTargetArtifactVerificationSummaries,
	officialWebTargetJobCandidates,
	officialWebTargetJobs,
	officialWebTargetPageAttempts,
} from "../../db/schema";
import type {
	NormalizedOfficialWebTargetJobListFilters,
	OfficialWebTargetArtifactVerificationDetail,
	OfficialWebTargetJobArtifactVerificationSummary,
	OfficialWebTargetJobCandidateRecord,
	OfficialWebTargetJobDetailRecord,
	OfficialWebTargetJobRecord,
	OfficialWebTargetJobStore,
	OfficialWebTargetJobUpsertRecord,
	OfficialWebTargetPageAttemptRecord,
} from "./service";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

function toArtifactVerificationSummary(
	row: typeof officialWebTargetArtifactVerificationSummaries.$inferSelect | null,
): OfficialWebTargetJobArtifactVerificationSummary | null {
	if (!row) {
		return null;
	}

	return {
		canonicalVerification: row.canonicalVerification,
		objectVerificationId: row.objectVerificationId ?? null,
		sourceHandoffId: row.sourceHandoffId ?? null,
		status: row.status,
		updatedAt: row.updatedAt.toISOString(),
	};
}

const BLOCKED_SUMMARY_KEY_PATTERNS = [
	"bucket",
	"dir",
	"file",
	"local",
	"object_key",
	"objectkey",
	"path",
	"prefix",
] as const;

function isOperatorSafeSummaryKey(key: string): boolean {
	const normalized = key.toLowerCase();
	return !BLOCKED_SUMMARY_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function sanitizeOperatorSummary(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sanitizeOperatorSummary);
	}
	if (!(value && typeof value === "object")) {
		return value;
	}

	const summary: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (isOperatorSafeSummaryKey(key)) {
			summary[key] = sanitizeOperatorSummary(item);
		}
	}
	return summary;
}

function toArtifactVerificationDetail(
	row: typeof officialWebTargetArtifactVerificationSummaries.$inferSelect,
): OfficialWebTargetArtifactVerificationDetail {
	return {
		canonicalVerification: row.canonicalVerification,
		objectVerificationId: row.objectVerificationId ?? null,
		runId: row.runId ?? null,
		sourceHandoffId: row.sourceHandoffId ?? null,
		status: row.status,
		summary: sanitizeOperatorSummary(row.summaryJson) as Record<string, unknown>,
		summaryId: row.summaryId,
		updatedAt: row.updatedAt.toISOString(),
	};
}

function toCandidateRecord(
	row: typeof officialWebTargetJobCandidates.$inferSelect,
): OfficialWebTargetJobCandidateRecord {
	return {
		candidateId: row.candidateId,
		createdAt: row.createdAt.toISOString(),
		eligibilityReason: row.eligibilityReason,
		normalizedCandidateUrl: row.normalizedCandidateUrl,
		priorityScore: row.priorityScore,
		sourceHost: row.sourceHost,
		status: row.status,
		titleHint: row.titleHint ?? null,
		updatedAt: row.updatedAt.toISOString(),
		urlHint: row.urlHint ?? null,
	};
}

function toAttemptRecord(
	row: typeof officialWebTargetPageAttempts.$inferSelect,
): OfficialWebTargetPageAttemptRecord {
	return {
		artifactCaptured: Boolean(row.artifactObjectKey),
		attemptId: row.attemptId,
		attemptStatus: row.attemptStatus,
		attemptedAt: row.attemptedAt.toISOString(),
		candidateId: row.candidateId ?? null,
		completedAt: row.completedAt ? row.completedAt.toISOString() : null,
		httpStatus: row.httpStatus ?? null,
		normalizedCanonicalUrl: row.normalizedCanonicalUrl,
		runId: row.runId ?? null,
	};
}

function toTargetJobRecord(
	row: typeof officialWebTargetJobs.$inferSelect,
	summary: typeof officialWebTargetArtifactVerificationSummaries.$inferSelect | null = null,
): OfficialWebTargetJobRecord {
	return {
		artifactVerificationSummary: toArtifactVerificationSummary(summary),
		attemptCount: row.attemptCount,
		candidateCount: row.candidateCount,
		consumerFamily: row.consumerFamily,
		createdAt: row.createdAt.toISOString(),
		declarationVersion: row.declarationVersion,
		id: row.jobId,
		idempotencyKey: row.idempotencyKey,
		inventoryOnly: row.inventoryOnly,
		latestRunId: row.latestRunId ?? null,
		materializationPolicy: row.materializationPolicy,
		ownerSurface: row.ownerSurface,
		requiredEvidence: row.requiredEvidenceJson ?? [],
		retentionPolicy: row.retentionPolicy,
		reviewPolicy: row.reviewPolicy,
		selectedWriteTarget: row.selectedWriteTarget,
		siteId: row.siteId,
		sourceHosts: row.sourceHostsJson ?? [],
		status: row.status,
		targetId: row.targetId,
		titleHints: row.titleHintsJson ?? [],
		updatedAt: row.updatedAt.toISOString(),
		urlHints: row.urlHintsJson ?? [],
	};
}

function mapLatestSummariesByJobId(
	rows: (typeof officialWebTargetArtifactVerificationSummaries.$inferSelect)[],
): Map<string, typeof officialWebTargetArtifactVerificationSummaries.$inferSelect> {
	const summariesByJob = new Map<string, typeof officialWebTargetArtifactVerificationSummaries.$inferSelect>();
	for (const row of rows) {
		if (!summariesByJob.has(row.jobId)) {
			summariesByJob.set(row.jobId, row);
		}
	}
	return summariesByJob;
}

function buildFilterConditions(filters: NormalizedOfficialWebTargetJobListFilters): SQL[] {
	const conditions: SQL[] = [];
	if (filters.siteId) {
		conditions.push(eq(officialWebTargetJobs.siteId, filters.siteId));
	}
	if (filters.targetId) {
		conditions.push(eq(officialWebTargetJobs.targetId, filters.targetId));
	}
	if (filters.status) {
		conditions.push(eq(officialWebTargetJobs.status, filters.status));
	}
	return conditions;
}

function toInsertRecord(record: OfficialWebTargetJobUpsertRecord) {
	return {
		candidateCount: 0,
		consumerFamily: record.consumerFamily,
		createdAt: new Date(record.createdAt),
		declarationVersion: record.declarationVersion,
		idempotencyKey: record.idempotencyKey,
		inventoryOnly: record.inventoryOnly,
		jobId: record.id,
		latestRunId: null,
		materializationPolicy: record.materializationPolicy,
		ownerSurface: record.ownerSurface,
		requiredEvidenceJson: record.requiredEvidence,
		retentionPolicy: record.retentionPolicy,
		reviewPolicy: record.reviewPolicy,
		selectedWriteTarget: record.selectedWriteTarget,
		siteId: record.siteId,
		sourceHostsJson: record.sourceHosts,
		status: record.status,
		targetId: record.targetId,
		titleHintsJson: record.titleHints,
		updatedAt: new Date(record.updatedAt),
		urlHintsJson: record.urlHints,
	};
}

export function createPgOfficialWebTargetJobStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): OfficialWebTargetJobStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async getTargetJobById(jobId) {
			const db = await getDb();
			const jobRows = await db
				.select()
				.from(officialWebTargetJobs)
				.where(eq(officialWebTargetJobs.jobId, jobId))
				.limit(1);
			const jobRow = jobRows[0];
			if (!jobRow) {
				return null;
			}

			const [summaryRows, candidateRows, attemptRows] = await Promise.all([
				db
					.select()
					.from(officialWebTargetArtifactVerificationSummaries)
					.where(eq(officialWebTargetArtifactVerificationSummaries.jobId, jobId))
					.orderBy(
						desc(officialWebTargetArtifactVerificationSummaries.updatedAt),
						desc(officialWebTargetArtifactVerificationSummaries.summaryId),
					)
					.limit(20),
				db
					.select()
					.from(officialWebTargetJobCandidates)
					.where(eq(officialWebTargetJobCandidates.jobId, jobId))
					.orderBy(
						desc(officialWebTargetJobCandidates.priorityScore),
						asc(officialWebTargetJobCandidates.normalizedCandidateUrl),
					)
					.limit(100),
				db
					.select()
					.from(officialWebTargetPageAttempts)
					.where(eq(officialWebTargetPageAttempts.jobId, jobId))
					.orderBy(
						desc(officialWebTargetPageAttempts.attemptedAt),
						desc(officialWebTargetPageAttempts.attemptId),
					)
					.limit(100),
			]);

			return {
				artifactVerificationSummaries: summaryRows.map(toArtifactVerificationDetail),
				attempts: attemptRows.map(toAttemptRecord),
				candidates: candidateRows.map(toCandidateRecord),
				job: toTargetJobRecord(jobRow, summaryRows[0] ?? null),
			} satisfies OfficialWebTargetJobDetailRecord;
		},

		async listTargetJobs(filters) {
			const db = await getDb();
			const conditions = buildFilterConditions(filters);
			const jobRows = await db
				.select()
				.from(officialWebTargetJobs)
				.where(conditions.length > 0 ? and(...conditions) : undefined)
				.orderBy(desc(officialWebTargetJobs.updatedAt), desc(officialWebTargetJobs.jobId))
				.limit(filters.limit);
			const jobIds = jobRows.map((row) => row.jobId);
			const summaryRows =
				jobIds.length > 0
					? await db
							.select()
							.from(officialWebTargetArtifactVerificationSummaries)
							.where(inArray(officialWebTargetArtifactVerificationSummaries.jobId, jobIds))
							.orderBy(
								desc(officialWebTargetArtifactVerificationSummaries.updatedAt),
								desc(officialWebTargetArtifactVerificationSummaries.summaryId),
							)
					: [];
			const summariesByJob = mapLatestSummariesByJobId(summaryRows);

			return {
				jobs: jobRows.map((row) => toTargetJobRecord(row, summariesByJob.get(row.jobId) ?? null)),
				page: { nextCursor: null },
			};
		},

		async upsertDeclaredTargetJobs(records) {
			if (records.length === 0) {
				return [];
			}

			const db = await getDb();
			const inserted = await db
				.insert(officialWebTargetJobs)
				.values(records.map(toInsertRecord))
				.onConflictDoUpdate({
					set: {
						consumerFamily: sql`excluded.consumer_family`,
						inventoryOnly: sql`excluded.inventory_only`,
						materializationPolicy: sql`excluded.materialization_policy`,
						ownerSurface: sql`excluded.owner_surface`,
						requiredEvidenceJson: sql`excluded.required_evidence_json`,
						retentionPolicy: sql`excluded.retention_policy`,
						reviewPolicy: sql`excluded.review_policy`,
						selectedWriteTarget: sql`excluded.selected_write_target`,
						sourceHostsJson: sql`excluded.source_hosts_json`,
						status: sql`excluded.status`,
						titleHintsJson: sql`excluded.title_hints_json`,
						updatedAt: sql`excluded.updated_at`,
						urlHintsJson: sql`excluded.url_hints_json`,
					},
					target: officialWebTargetJobs.idempotencyKey,
				})
				.returning();

			return inserted.map((row) => toTargetJobRecord(row));
		},
	};
}
