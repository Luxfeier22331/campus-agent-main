import type { OfficialWebRunIntent } from "../official-web-command";

export type OfficialWebRunAdmissionDecisionValue = "legacy_contract_excluded";

export interface OfficialWebRunAdmissionDecisionRecord {
	decidedAt: string;
	decision: OfficialWebRunAdmissionDecisionValue;
	decisionId: string;
	reasonCode: string;
	runId: string;
	siteId: string;
}

export interface OfficialWebRunAdmissionCleanupCandidate {
	configVersion: string;
	runId: string;
	runIntent: OfficialWebRunIntent;
	schedulerRunKey: string;
	siteId: string;
	startedAt: string;
	summary: Record<string, unknown> | null;
}

export interface OfficialWebLegacyExclusionDecisionWrite
	extends OfficialWebRunAdmissionDecisionRecord {
	createdAt: string;
	decidedBy: string;
	evidence: Record<string, unknown>;
	reason: string;
	updatedAt: string;
}

export interface OfficialWebRunAdmissionCleanupStore {
	insertLegacyExclusionDecisions(
		decisions: OfficialWebLegacyExclusionDecisionWrite[],
	): Promise<number>;
	listCleanupCandidates(input: {
		before: string;
		limit?: number;
		siteId: string;
	}): Promise<OfficialWebRunAdmissionCleanupCandidate[]>;
}

export interface OfficialWebRunAdmissionCleanupResult {
	action: "apply" | "dry-run";
	before: string;
	candidates: OfficialWebLegacyExclusionDecisionWrite[];
	decision: OfficialWebRunAdmissionDecisionValue;
	insertedCount: number;
	siteId: string;
}

export interface OfficialWebRunAdmissionCleanupService {
	applyLegacyCleanup(input: {
		before: string;
		limit?: number;
		siteId: string;
	}): Promise<OfficialWebRunAdmissionCleanupResult>;
	planLegacyCleanup(input: {
		before: string;
		limit?: number;
		siteId: string;
	}): Promise<OfficialWebRunAdmissionCleanupResult>;
}

export interface OfficialWebRunAdmissionCleanupServiceDependencies {
	generateId?: () => string;
	now?: () => Date;
	store: OfficialWebRunAdmissionCleanupStore;
}

const LEGACY_EXCLUSION_DECISION: OfficialWebRunAdmissionDecisionValue = "legacy_contract_excluded";
const LEGACY_EXCLUSION_REASON_CODE = "legacy_broad_crawl_contract";
const LEGACY_EXCLUSION_REASON =
	"Run predates the consumer-driven official_web target-source-map and consumer-denominator contract; exclude it from projection handoff and selected-write.";

function hasConsumerDrivenEvidence(summary: Record<string, unknown> | null): boolean {
	if (!summary) {
		return false;
	}

	return [
		"consumerDenominatorVersion",
		"consumer_denominator_version",
		"consumerFamilyCounts",
		"consumer_family_counts",
		"consumerCandidateReview",
		"consumer_candidate_review",
		"retainedSourceTruthPages",
		"retained_source_truth_pages",
	].some((key) => summary[key] != null);
}

function normalizeBefore(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.valueOf())) {
		throw new Error("--before must be a valid ISO timestamp.");
	}
	return parsed.toISOString();
}

function buildLegacyDecision(input: {
	candidate: OfficialWebRunAdmissionCleanupCandidate;
	decidedAt: string;
	generateId: () => string;
}): OfficialWebLegacyExclusionDecisionWrite {
	return {
		createdAt: input.decidedAt,
		decidedAt: input.decidedAt,
		decidedBy: "app-api.official-web-legacy-cleanup",
		decision: LEGACY_EXCLUSION_DECISION,
		decisionId: input.generateId(),
		evidence: {
			configVersion: input.candidate.configVersion,
			runIntent: input.candidate.runIntent,
			schedulerRunKey: input.candidate.schedulerRunKey,
			startedAt: input.candidate.startedAt,
			summaryKeys: Object.keys(input.candidate.summary ?? {}).sort(),
		},
		reason: LEGACY_EXCLUSION_REASON,
		reasonCode: LEGACY_EXCLUSION_REASON_CODE,
		runId: input.candidate.runId,
		siteId: input.candidate.siteId,
		updatedAt: input.decidedAt,
	};
}

function filterLegacyCandidates(
	candidates: OfficialWebRunAdmissionCleanupCandidate[],
): OfficialWebRunAdmissionCleanupCandidate[] {
	return candidates.filter((candidate) => !hasConsumerDrivenEvidence(candidate.summary));
}

export function buildOfficialWebRunAdmissionCleanupService(
	dependencies: OfficialWebRunAdmissionCleanupServiceDependencies,
): OfficialWebRunAdmissionCleanupService {
	const now = dependencies.now ?? (() => new Date());
	const generateId =
		dependencies.generateId ?? (() => `owad_${crypto.randomUUID().replaceAll("-", "")}`);

	async function buildPlan(input: {
		before: string;
		limit?: number;
		siteId: string;
	}): Promise<OfficialWebRunAdmissionCleanupResult> {
		const before = normalizeBefore(input.before);
		const candidates = filterLegacyCandidates(
			await dependencies.store.listCleanupCandidates({
				before,
				limit: input.limit,
				siteId: input.siteId,
			}),
		);
		const decidedAt = now().toISOString();

		return {
			action: "dry-run",
			before,
			candidates: candidates.map((candidate) =>
				buildLegacyDecision({
					candidate,
					decidedAt,
					generateId,
				}),
			),
			decision: LEGACY_EXCLUSION_DECISION,
			insertedCount: 0,
			siteId: input.siteId,
		};
	}

	return {
		async applyLegacyCleanup(input) {
			const plan = await buildPlan(input);
			const insertedCount = await dependencies.store.insertLegacyExclusionDecisions(
				plan.candidates,
			);
			return {
				...plan,
				action: "apply",
				insertedCount,
			};
		},
		planLegacyCleanup: buildPlan,
	};
}
