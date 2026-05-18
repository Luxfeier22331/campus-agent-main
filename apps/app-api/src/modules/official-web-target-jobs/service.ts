import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";

export interface OfficialWebTargetDeclarationInput {
	consumerFamily: string;
	inventoryOnly: boolean;
	materializationPolicy: string;
	ownerSurface: string;
	requiredEvidence: string[];
	retentionPolicy: string;
	reviewPolicy: string;
	selectedWriteTarget: string;
	sourceHosts: string[];
	targetId: string;
	titleHints: string[];
	urlHints: string[];
}

export interface OfficialWebTargetJobArtifactVerificationSummary {
	canonicalVerification: boolean;
	objectVerificationId: string | null;
	sourceHandoffId: string | null;
	status: string;
	updatedAt: string;
}

export interface OfficialWebTargetJobRecord extends OfficialWebTargetDeclarationInput {
	artifactVerificationSummary: OfficialWebTargetJobArtifactVerificationSummary | null;
	attemptCount: number;
	candidateCount: number;
	createdAt: string;
	declarationVersion: string;
	id: string;
	idempotencyKey: string;
	latestRunId: string | null;
	siteId: string;
	status: string;
	updatedAt: string;
}

export interface OfficialWebTargetJobCandidateRecord {
	candidateId: string;
	createdAt: string;
	eligibilityReason: string;
	normalizedCandidateUrl: string;
	priorityScore: number;
	sourceHost: string;
	status: string;
	titleHint: string | null;
	updatedAt: string;
	urlHint: string | null;
}

export interface OfficialWebTargetPageAttemptRecord {
	artifactCaptured: boolean;
	attemptId: string;
	attemptStatus: string;
	attemptedAt: string;
	candidateId: string | null;
	completedAt: string | null;
	httpStatus: number | null;
	normalizedCanonicalUrl: string;
	runId: string | null;
}

export interface OfficialWebTargetArtifactVerificationDetail
	extends OfficialWebTargetJobArtifactVerificationSummary {
	runId: string | null;
	summary: Record<string, unknown>;
	summaryId: string;
}

export interface OfficialWebTargetJobDetailRecord {
	artifactVerificationSummaries: OfficialWebTargetArtifactVerificationDetail[];
	attempts: OfficialWebTargetPageAttemptRecord[];
	candidates: OfficialWebTargetJobCandidateRecord[];
	job: OfficialWebTargetJobRecord;
}

export interface OfficialWebTargetJobListFilters {
	cursor?: string | null;
	limit?: number | null;
	siteId?: string | null;
	status?: string | null;
	targetId?: string | null;
}

export interface NormalizedOfficialWebTargetJobListFilters {
	cursor: string | null;
	limit: number;
	siteId: string | null;
	status: string | null;
	targetId: string | null;
}

export interface OfficialWebTargetJobUpsertRecord extends OfficialWebTargetDeclarationInput {
	createdAt: string;
	declarationVersion: string;
	id: string;
	idempotencyKey: string;
	siteId: string;
	status: string;
	updatedAt: string;
}

export interface OfficialWebTargetJobStore {
	getTargetJobById(jobId: string): Promise<OfficialWebTargetJobDetailRecord | null>;
	listTargetJobs(filters: NormalizedOfficialWebTargetJobListFilters): Promise<{
		jobs: OfficialWebTargetJobRecord[];
		page: { nextCursor: string | null };
	}>;
	upsertDeclaredTargetJobs(
		records: OfficialWebTargetJobUpsertRecord[],
	): Promise<OfficialWebTargetJobRecord[]>;
}

export interface OfficialWebTargetJobService {
	getTargetJobById(input: {
		jobId: string;
		principal: ResolvedAppPrincipal;
	}): Promise<OfficialWebTargetJobDetailRecord>;
	listTargetJobs(input: {
		filters: OfficialWebTargetJobListFilters;
		principal: ResolvedAppPrincipal;
	}): Promise<{
		jobs: OfficialWebTargetJobRecord[];
		page: { nextCursor: string | null };
	}>;
	upsertDeclaredTargetJobs(input: {
		declarationVersion: string;
		siteId: string;
		targets: OfficialWebTargetDeclarationInput[];
	}): Promise<OfficialWebTargetJobRecord[]>;
}

export interface OfficialWebTargetJobServiceDependencies {
	now?: () => Date;
	store: OfficialWebTargetJobStore;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function ensureOperatorPrincipal(principal: ResolvedAppPrincipal): void {
	if (!principal.permissions.operator) {
		throw new AppApiRouteError({
			code: "forbidden",
			message: "Operator access is not available for this principal.",
			retryable: false,
			status: 403,
		});
	}
}

function normalizeOptionalString(value: string | null | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

function normalizeLimit(value: number | null | undefined): number {
	if (!(Number.isFinite(value) && value) || value < 1) {
		return DEFAULT_LIMIT;
	}

	return Math.min(Math.floor(value), MAX_LIMIT);
}

function normalizeListFilters(
	filters: OfficialWebTargetJobListFilters,
): NormalizedOfficialWebTargetJobListFilters {
	return {
		cursor: normalizeOptionalString(filters.cursor),
		limit: normalizeLimit(filters.limit),
		siteId: normalizeOptionalString(filters.siteId),
		status: normalizeOptionalString(filters.status),
		targetId: normalizeOptionalString(filters.targetId),
	};
}

function buildTargetJobId(siteId: string, targetId: string): string {
	return `owtarget_${siteId}_${targetId}`.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function buildIdempotencyKey(input: {
	declarationVersion: string;
	siteId: string;
	targetId: string;
}): string {
	return `${input.siteId}:${input.declarationVersion}:${input.targetId}`;
}

export function buildOfficialWebTargetJobService(
	dependencies: OfficialWebTargetJobServiceDependencies,
): OfficialWebTargetJobService {
	const now = dependencies.now ?? (() => new Date());

	return {
		async getTargetJobById(input) {
			ensureOperatorPrincipal(input.principal);
			const jobId = normalizeOptionalString(input.jobId);
			if (!jobId) {
				throw new AppApiRouteError({
					code: "target_job_not_found",
					message: "Official web target job not found.",
					retryable: false,
					status: 404,
				});
			}

			const detail = await dependencies.store.getTargetJobById(jobId);
			if (!detail) {
				throw new AppApiRouteError({
					code: "target_job_not_found",
					message: "Official web target job not found.",
					retryable: false,
					status: 404,
				});
			}

			return detail;
		},

		async listTargetJobs(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listTargetJobs(normalizeListFilters(input.filters));
		},

		async upsertDeclaredTargetJobs(input) {
			const timestamp = now().toISOString();
			return dependencies.store.upsertDeclaredTargetJobs(
				input.targets.map((target) => ({
					...target,
					createdAt: timestamp,
					declarationVersion: input.declarationVersion,
					id: buildTargetJobId(input.siteId, target.targetId),
					idempotencyKey: buildIdempotencyKey({
						declarationVersion: input.declarationVersion,
						siteId: input.siteId,
						targetId: target.targetId,
					}),
					siteId: input.siteId,
					status: "declared",
					updatedAt: timestamp,
				})),
			);
		},
	};
}
