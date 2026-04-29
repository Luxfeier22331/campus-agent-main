import { describe, expect, it } from "vitest";

import type {
	PublicDocsReleaseLedger,
	PublicDocsReleaseLedgerRecord,
} from "../scripts/check-published-reader-manifest";
import {
	findRetryBaseRecord,
	resolveNextAttemptNumber,
	resolvePublicDocsReleaseRetryDecision,
} from "../scripts/published-reader-release-retry-policy";

function failedRecord(
	overrides: Partial<PublicDocsReleaseLedgerRecord> = {},
): PublicDocsReleaseLedgerRecord {
	return {
		candidateManifestDigest: "digest-a",
		candidateReleaseId: "release-a",
		completedAt: "2026-04-29T10:05:00.000Z",
		environment: "prod",
		failureReason: "deploy failed",
		id: "failed-1",
		startedAt: "2026-04-29T10:00:00.000Z",
		status: "failed",
		surface: "public_docs",
		validation: { errors: [], ok: true, warnings: [] },
		...overrides,
	};
}

function ledger(records: PublicDocsReleaseLedger["records"]): PublicDocsReleaseLedger {
	return { records, version: 1 };
}

describe("published reader release retry policy", () => {
	it("rejects invalid or blocked manifest failures as non-retryable", () => {
		const decision = resolvePublicDocsReleaseRetryDecision({
			currentManifestDigest: "digest-a",
			ledger: ledger([
				failedRecord({
					failureReason: "manifest JSON is invalid",
					id: "failed-invalid",
					validation: { errors: ["manifest JSON is invalid"], ok: false, warnings: [] },
				}),
			]),
			recordId: "failed-invalid",
		});

		expect(decision).toMatchObject({
			retryable: false,
			reason: "manifest_not_retryable",
		});
	});

	it("allows retry for the latest failed candidate when the manifest digest is still current", () => {
		const base = failedRecord();
		const releaseLedger = ledger([base]);

		expect(
			resolvePublicDocsReleaseRetryDecision({
				currentManifestDigest: "digest-a",
				ledger: releaseLedger,
				recordId: "failed-1",
			}),
		).toMatchObject({
			attemptNumber: 1,
			baseRecord: base,
			retryable: true,
		});
	});

	it("rejects retry when a newer deployed record already superseded the failed candidate", () => {
		const decision = resolvePublicDocsReleaseRetryDecision({
			currentManifestDigest: "digest-a",
			ledger: ledger([
				failedRecord(),
				{
					candidateManifestDigest: "digest-b",
					candidateReleaseId: "release-b",
					cloudflareVersionId: "version-b",
					completedAt: "2026-04-29T11:05:00.000Z",
					environment: "prod",
					id: "deployed-2",
					startedAt: "2026-04-29T11:00:00.000Z",
					status: "deployed",
					surface: "public_docs",
					validation: { errors: [], ok: true, warnings: [] },
				},
			]),
			recordId: "failed-1",
		});

		expect(decision).toMatchObject({
			retryable: false,
			reason: "superseded_by_deployed_release",
		});
	});

	it("rejects retry when the current manifest digest no longer matches the failed candidate", () => {
		expect(
			resolvePublicDocsReleaseRetryDecision({
				currentManifestDigest: "digest-new",
				ledger: ledger([failedRecord()]),
				recordId: "failed-1",
			}),
		).toMatchObject({
			retryable: false,
			reason: "candidate_digest_not_current",
		});
	});

	it("resolves next attempt number from prior retry records", () => {
		expect(
			resolveNextAttemptNumber({
				ledger: ledger([
					failedRecord(),
					failedRecord({
						attemptNumber: 1,
						id: "retry-1",
						retryOfRecordId: "failed-1",
					}),
				]),
				recordId: "failed-1",
			}),
		).toBe(2);
	});

	it("finds the latest failed base record when no record id is supplied", () => {
		expect(
			findRetryBaseRecord({
				ledger: ledger([
					failedRecord({ id: "failed-old", startedAt: "2026-04-29T09:00:00.000Z" }),
					failedRecord({ id: "failed-new", startedAt: "2026-04-29T10:00:00.000Z" }),
				]),
			})?.id,
		).toBe("failed-new");
	});
});
