import { and, asc, desc, eq, inArray, isNull, lte, not, or } from "drizzle-orm";

import type { Env } from "../../config";
import { withRuntimeDatabase } from "../../db/runtime";
import {
	officialWebTargetJobCandidates,
	officialWebTargetJobs,
	officialWebTargetPageAttempts,
	pageFreshness,
} from "../../db/schema";
import type { OfficialWebFetchDisposition } from "../official-web-command";
import type {
	NormalizedOfficialWebPlannerFilters,
	OfficialWebPlannerFetchDisposition,
	OfficialWebPlannerPageCandidate,
	OfficialWebPlannerStore,
} from "./service";

function toIsoString(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}

interface TargetCandidateRow {
	candidate: typeof officialWebTargetJobCandidates.$inferSelect;
	freshness: typeof pageFreshness.$inferSelect | null;
	job: typeof officialWebTargetJobs.$inferSelect;
}

interface TargetRepairRow {
	attempt: typeof officialWebTargetPageAttempts.$inferSelect;
	candidate: typeof officialWebTargetJobCandidates.$inferSelect | null;
	freshness: typeof pageFreshness.$inferSelect | null;
	job: typeof officialWebTargetJobs.$inferSelect;
}

function normalizePlannerFetchDisposition(
	value: OfficialWebFetchDisposition | null,
): OfficialWebPlannerFetchDisposition {
	return value ?? "never_fetched";
}

function normalizeOptionalTitle(value: string | null | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

function resolvePlannerPageTitle(input: {
	freshnessTitle: string | null | undefined;
	candidateTitleHint: string | null | undefined;
	jobTitleHints: string[] | null | undefined;
}): string {
	const freshnessTitle = normalizeOptionalTitle(input.freshnessTitle);
	if (freshnessTitle) {
		return freshnessTitle;
	}

	const candidateTitleHint = normalizeOptionalTitle(input.candidateTitleHint);
	if (candidateTitleHint) {
		return candidateTitleHint;
	}

	for (const hint of input.jobTitleHints ?? []) {
		const normalizedHint = normalizeOptionalTitle(hint);
		if (normalizedHint) {
			return normalizedHint;
		}
	}

	return "";
}

function toPlannerPageCandidate(row: TargetCandidateRow): OfficialWebPlannerPageCandidate {
	const freshness = row.freshness;
	return {
		cadenceClass: freshness?.cadenceClass ?? "target_candidate",
		consumerFamily: row.job.consumerFamily,
		contentType: freshness?.contentType ?? null,
		discoveredFromUrl: freshness?.discoveredFromUrl ?? null,
		discoveryMethod: freshness?.discoveryMethod ?? "manual_requeue",
		etag: freshness?.etag ?? null,
		fetchProfile: "target_candidate_fetch",
		host: row.candidate.sourceHost,
		hostPolicy: {
			host: row.candidate.sourceHost,
			sourceHost: row.candidate.sourceHost,
		},
		inventoryOnly: row.job.inventoryOnly,
		lastChangeReason: freshness?.lastChangeReason ?? "target_candidate_admitted",
		lastChangedAt: toIsoString(freshness?.lastChangedAt ?? null),
		lastFetchDisposition: normalizePlannerFetchDisposition(
			(freshness?.lastFetchDisposition as OfficialWebFetchDisposition | undefined) ?? null,
		),
		lastHttpStatus: freshness?.lastHttpStatus ?? null,
		lastModified: freshness?.lastModified ?? null,
		lastNotModifiedAt: toIsoString(freshness?.lastNotModifiedAt ?? null),
		lastSeenAt: (freshness?.lastSeenAt ?? row.candidate.createdAt).toISOString(),
		lastSuccessfulRunId: freshness?.lastSuccessfulRunId ?? null,
		mainContentHash: freshness?.mainContentHash ?? null,
		materializationPolicy: row.job.materializationPolicy,
		nextEligibleFetchAt: (freshness?.nextEligibleFetchAt ?? row.candidate.updatedAt).toISOString(),
		normalizedCanonicalUrl: row.candidate.normalizedCandidateUrl,
		pageFamily: freshness?.pageFamily ?? "target_candidate",
		pageTitleNormalized: resolvePlannerPageTitle({
			freshnessTitle: freshness?.pageTitleNormalized,
			candidateTitleHint: row.candidate.titleHint,
			jobTitleHints: row.job.titleHintsJson,
		}),
		priorityScore: row.candidate.priorityScore,
		responseBodyHash: freshness?.responseBodyHash ?? null,
		retentionPolicy: row.job.retentionPolicy,
		reviewPolicy: row.job.reviewPolicy,
		selectedWriteTarget: row.job.selectedWriteTarget,
		siteId: row.candidate.siteId,
		targetCandidateId: row.candidate.candidateId,
		targetDeclarationVersion: row.job.declarationVersion,
		targetId: row.job.targetId,
		targetJobId: row.job.jobId,
		worksetReason: row.candidate.eligibilityReason || "target_candidate_due",
	};
}

function toRepairPlannerPageCandidate(row: TargetRepairRow): OfficialWebPlannerPageCandidate {
	const candidate =
		row.candidate ??
		({
			candidateId: null,
			createdAt: row.attempt.createdAt,
			eligibilityReason: "target_candidate_repair",
			normalizedCandidateUrl: row.attempt.normalizedCanonicalUrl,
			priorityScore: 0,
			siteId: row.attempt.siteId,
			sourceHost: new URL(row.attempt.normalizedCanonicalUrl).hostname.toLowerCase(),
			updatedAt: row.attempt.updatedAt,
		} as const);
	return {
		...toPlannerPageCandidate({
			candidate: candidate as typeof officialWebTargetJobCandidates.$inferSelect,
			freshness: row.freshness,
			job: row.job,
		}),
		fetchProfile: "target_repair_fetch",
		lastChangeReason: row.freshness?.lastChangeReason ?? "target_candidate_repair",
		lastFetchDisposition: row.freshness?.lastFetchDisposition
			? (row.freshness.lastFetchDisposition as OfficialWebFetchDisposition)
			: "fetch_failed",
		normalizedCanonicalUrl: row.attempt.normalizedCanonicalUrl,
		targetCandidateId: row.candidate?.candidateId ?? null,
		worksetReason: "target_candidate_repair",
	};
}

function resolveFetchLimit(filters: NormalizedOfficialWebPlannerFilters): number {
	const hostCount = Math.max(filters.hostFilter.length, 1);
	return Math.max(filters.maxTotalPages * 4, filters.maxPagesPerHost * hostCount * 2);
}

function selectBudgetedRows<T extends { host: string; normalizedCanonicalUrl: string; targetJobId: string }>(
	rows: T[],
	filters: NormalizedOfficialWebPlannerFilters,
	options: {
		dedupeByCanonicalUrl?: boolean;
	} = {},
): T[] {
	const selected: T[] = [];
	const remainingByHost = new Map<string, number>();
	const remainingByTarget = new Map<string, number>();
	const selectedCanonicalUrls = new Set<string>();
	const selectedTargetCanonicalKeys = new Set<string>();

	for (const row of rows) {
		const canonicalUrlKey = row.normalizedCanonicalUrl;
		const targetCanonicalKey = `${row.targetJobId}::${canonicalUrlKey}`;
		const reuseSelectedCanonicalUrl =
			options.dedupeByCanonicalUrl === true && selectedCanonicalUrls.has(canonicalUrlKey);
		const reuseSelectedTargetCanonicalKey =
			options.dedupeByCanonicalUrl === true &&
			selectedTargetCanonicalKeys.has(targetCanonicalKey);

		if (
			(options.dedupeByCanonicalUrl === true
				? selectedCanonicalUrls.size
				: selected.length) >= filters.maxTotalPages &&
			!reuseSelectedCanonicalUrl
		) {
			break;
		}

		if (!reuseSelectedCanonicalUrl) {
			const hostRemaining = remainingByHost.get(row.host) ?? filters.maxPagesPerHost;
			if (hostRemaining < 1) {
				continue;
			}
			remainingByHost.set(row.host, hostRemaining - 1);
			selectedCanonicalUrls.add(canonicalUrlKey);
		}

		if (!reuseSelectedTargetCanonicalKey) {
			const targetRemaining =
				remainingByTarget.get(row.targetJobId) ?? filters.maxPagesPerHost;
			if (targetRemaining < 1) {
				if (!reuseSelectedCanonicalUrl) {
					selectedCanonicalUrls.delete(canonicalUrlKey);
					remainingByHost.set(row.host, (remainingByHost.get(row.host) ?? 0) + 1);
				}
				continue;
			}
			remainingByTarget.set(row.targetJobId, targetRemaining - 1);
			selectedTargetCanonicalKeys.add(targetCanonicalKey);
		}

		selected.push(row);
	}

	return selected;
}

export const __officialWebPlannerStoreTestUtils = {
	resolvePlannerPageTitle,
	selectBudgetedRows,
};

export function createPgOfficialWebPlannerStore(env: Env): OfficialWebPlannerStore {
	return {
		async listDuePages(filters) {
			return withRuntimeDatabase(env, async (db) => {
				if (filters.runIntent === "repair") {
					const repairConditions = [
						eq(officialWebTargetPageAttempts.siteId, filters.siteId),
						inArray(officialWebTargetPageAttempts.attemptStatus, [
							"fetch_failed",
							"failed",
							"request_failed",
						]),
					];
					if (filters.targetCandidateIds.length > 0) {
						repairConditions.push(
							inArray(
								officialWebTargetPageAttempts.candidateId,
								filters.targetCandidateIds,
							),
						);
					}

					const rows = await db
						.select({
							attempt: officialWebTargetPageAttempts,
							candidate: officialWebTargetJobCandidates,
							freshness: pageFreshness,
							job: officialWebTargetJobs,
						})
						.from(officialWebTargetPageAttempts)
						.innerJoin(
							officialWebTargetJobs,
							eq(officialWebTargetJobs.jobId, officialWebTargetPageAttempts.jobId),
						)
						.leftJoin(
							officialWebTargetJobCandidates,
							eq(
								officialWebTargetJobCandidates.candidateId,
								officialWebTargetPageAttempts.candidateId,
							),
						)
						.leftJoin(
							pageFreshness,
							and(
								eq(pageFreshness.siteId, officialWebTargetPageAttempts.siteId),
								eq(
									pageFreshness.normalizedCanonicalUrl,
									officialWebTargetPageAttempts.normalizedCanonicalUrl,
								),
							),
						)
						.where(and(...repairConditions))
						.orderBy(
							desc(officialWebTargetPageAttempts.attemptedAt),
							asc(officialWebTargetPageAttempts.normalizedCanonicalUrl),
						)
						.limit(resolveFetchLimit(filters));

					const candidates = rows
						.map(toRepairPlannerPageCandidate)
						.filter(
							(row) => filters.hostFilter.length === 0 || filters.hostFilter.includes(row.host),
						);
					return selectBudgetedRows(candidates, filters, {
						dedupeByCanonicalUrl: filters.targetCandidateIds.length > 0,
					});
				}

				const conditions = [
					eq(officialWebTargetJobCandidates.siteId, filters.siteId),
					inArray(officialWebTargetJobs.status, ["declared", "active"]),
					inArray(officialWebTargetJobCandidates.status, ["eligible", "pending", "queued"]),
					or(
						isNull(pageFreshness.nextEligibleFetchAt),
						lte(pageFreshness.nextEligibleFetchAt, new Date(filters.now)),
					),
				];
				if (filters.targetCandidateIds.length === 0) {
					conditions.push(
						or(
							isNull(pageFreshness.lastFetchDisposition),
							not(eq(pageFreshness.lastFetchDisposition, "deleted")),
						),
					);
				}

				if (filters.hostFilter.length > 0) {
					conditions.push(inArray(officialWebTargetJobCandidates.sourceHost, filters.hostFilter));
				}
				if (filters.targetCandidateIds.length > 0) {
					conditions.push(
						inArray(officialWebTargetJobCandidates.candidateId, filters.targetCandidateIds),
					);
				}

				const rows = await db
					.select({
						candidate: officialWebTargetJobCandidates,
						freshness: pageFreshness,
						job: officialWebTargetJobs,
					})
					.from(officialWebTargetJobCandidates)
					.innerJoin(
						officialWebTargetJobs,
						eq(officialWebTargetJobs.jobId, officialWebTargetJobCandidates.jobId),
					)
					.leftJoin(
						pageFreshness,
						and(
							eq(pageFreshness.siteId, officialWebTargetJobCandidates.siteId),
							eq(
								pageFreshness.normalizedCanonicalUrl,
								officialWebTargetJobCandidates.normalizedCandidateUrl,
							),
						),
					)
					.where(and(...conditions))
					.orderBy(
						desc(officialWebTargetJobCandidates.priorityScore),
						asc(officialWebTargetJobCandidates.updatedAt),
						asc(officialWebTargetJobCandidates.normalizedCandidateUrl),
					)
					.limit(resolveFetchLimit(filters));

				return selectBudgetedRows(rows.map(toPlannerPageCandidate), filters, {
					dedupeByCanonicalUrl: filters.targetCandidateIds.length > 0,
				});
			});
		},
	};
}
