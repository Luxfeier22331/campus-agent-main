import type { OfficialWebFetchDisposition } from "ingestion-contracts";
import type { PersistedOfficialWebPageObservation } from "./official-web-control-plane-types";
import type { PgQueryable } from "./postgres-store";

export async function insertTargetAttempts(
	client: PgQueryable,
	observations: PersistedOfficialWebPageObservation[],
	writeTimestamp: string,
) {
	const attempts = observations.flatMap((observation) => {
		const matches =
			observation.targetMatches.length > 0
				? observation.targetMatches
				: observation.targetJobId && observation.targetId && observation.targetDeclarationVersion
					? [
							{
								targetCandidateId: observation.targetCandidateId,
								targetDeclarationVersion: observation.targetDeclarationVersion,
								targetId: observation.targetId,
								targetJobId: observation.targetJobId,
							},
						]
					: [];
		return matches.map((match) => ({
			attemptId: `owattempt_${observation.observationId}_${match.targetJobId}`,
			attemptStatus: toTargetAttemptStatus(observation.fetchDisposition),
			attemptedAt: observation.observedAt,
			candidateId: match.targetCandidateId,
			completedAt: observation.observedAt,
			httpStatus: observation.httpStatus,
			jobId: match.targetJobId,
			normalizedCanonicalUrl: observation.normalizedCanonicalUrl,
			runId: observation.runId,
			siteId: observation.siteId,
			targetId: match.targetId,
		}));
	});
	for (const attempt of attempts) {
		await client.query(
			`
INSERT INTO official_web.target_page_attempts (
	attempt_id, job_id, candidate_id, run_id, site_id, target_id, normalized_canonical_url,
	attempt_status, http_status, artifact_object_key, attempted_at, completed_at, created_at,
	updated_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10::timestamptz, $11::timestamptz,
	$12::timestamptz, $12::timestamptz
)`,
			[
				attempt.attemptId,
				attempt.jobId,
				attempt.candidateId,
				attempt.runId,
				attempt.siteId,
				attempt.targetId,
				attempt.normalizedCanonicalUrl,
				attempt.attemptStatus,
				attempt.httpStatus,
				attempt.attemptedAt,
				attempt.completedAt,
				writeTimestamp,
			],
		);
	}
	const attemptCountsByJob = new Map<string, number>();
	for (const attempt of attempts) {
		attemptCountsByJob.set(attempt.jobId, (attemptCountsByJob.get(attempt.jobId) ?? 0) + 1);
	}
	for (const [jobId, attemptCount] of attemptCountsByJob) {
		await client.query(
			`
UPDATE official_web.target_jobs
SET attempt_count = attempt_count + $1,
	latest_run_id = $2,
	status = 'active',
	updated_at = $3::timestamptz
WHERE job_id = $4`,
			[
				attemptCount,
				attempts.find((attempt) => attempt.jobId === jobId)?.runId,
				writeTimestamp,
				jobId,
			],
		);
	}
}

function toTargetAttemptStatus(
	fetchDisposition: OfficialWebFetchDisposition,
): "completed" | "deleted" | "fetch_failed" {
	if (fetchDisposition === "deleted") {
		return "deleted";
	}
	if (fetchDisposition === "fetch_failed") {
		return "fetch_failed";
	}
	return "completed";
}
