import type {
	PublicDocsReleaseLedger,
	PublicDocsReleaseLedgerRecord,
} from "./check-published-reader-manifest";

export type PublicDocsReleaseRetryBlockedReason =
	| "candidate_digest_not_current"
	| "manifest_not_retryable"
	| "record_not_failed"
	| "record_not_found"
	| "superseded_by_deployed_release";

export type PublicDocsReleaseRetryDecision =
	| {
			attemptNumber: number;
			baseRecord: PublicDocsReleaseLedgerRecord;
			retryable: true;
	  }
	| {
			baseRecord?: PublicDocsReleaseLedgerRecord;
			reason: PublicDocsReleaseRetryBlockedReason;
			retryable: false;
	  };

export function resolvePublicDocsReleaseRetryDecision(input: {
	currentManifestDigest: string;
	environment?: PublicDocsReleaseLedgerRecord["environment"];
	ledger: PublicDocsReleaseLedger;
	recordId?: string;
}): PublicDocsReleaseRetryDecision {
	const baseRecord = findRetryBaseRecord({
		environment: input.environment,
		ledger: input.ledger,
		recordId: input.recordId,
	});
	if (!baseRecord) {
		return { reason: "record_not_found", retryable: false };
	}
	if (baseRecord.status !== "failed") {
		return { baseRecord, reason: "record_not_failed", retryable: false };
	}
	if (!baseRecord.validation.ok) {
		return { baseRecord, reason: "manifest_not_retryable", retryable: false };
	}
	if (baseRecord.candidateManifestDigest !== input.currentManifestDigest) {
		return { baseRecord, reason: "candidate_digest_not_current", retryable: false };
	}
	if (hasNewerDeployedRecord({ baseRecord, ledger: input.ledger })) {
		return {
			baseRecord,
			reason: "superseded_by_deployed_release",
			retryable: false,
		};
	}
	return {
		attemptNumber: resolveNextAttemptNumber({
			ledger: input.ledger,
			recordId: baseRecord.retryOfRecordId ?? baseRecord.id,
		}),
		baseRecord,
		retryable: true,
	};
}

export function findRetryBaseRecord(input: {
	environment?: PublicDocsReleaseLedgerRecord["environment"];
	ledger: PublicDocsReleaseLedger;
	recordId?: string;
}): PublicDocsReleaseLedgerRecord | undefined {
	if (input.recordId) {
		return input.ledger.records.find(
			(record) =>
				record.id === input.recordId &&
				(!input.environment || record.environment === input.environment),
		);
	}
	return [...input.ledger.records]
		.reverse()
		.find(
			(record) =>
				record.surface === "public_docs" &&
				record.status === "failed" &&
				(!input.environment || record.environment === input.environment),
		);
}

export function resolveNextAttemptNumber(input: {
	ledger: PublicDocsReleaseLedger;
	recordId: string;
}): number {
	const priorAttempts = input.ledger.records
		.filter((record) => record.retryOfRecordId === input.recordId)
		.map((record) => record.attemptNumber ?? 0);
	return Math.max(0, ...priorAttempts) + 1;
}

function hasNewerDeployedRecord(input: {
	baseRecord: PublicDocsReleaseLedgerRecord;
	ledger: PublicDocsReleaseLedger;
}): boolean {
	const baseIndex = input.ledger.records.findIndex((record) => record.id === input.baseRecord.id);
	if (baseIndex < 0) {
		return false;
	}
	return input.ledger.records
		.slice(baseIndex + 1)
		.some(
			(record) =>
				record.surface === "public_docs" &&
				record.environment === input.baseRecord.environment &&
				record.status === "deployed",
		);
}
