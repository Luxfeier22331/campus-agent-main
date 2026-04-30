import type { AttachmentFetchAdmission } from "./attachment-materialization";
import type { BundleFileReleaseRecord, BundleNoticeRecord } from "./types";

export function aggregateAttachmentFacts(bundleRecords: BundleNoticeRecord[]): {
	attachmentReferenceOnly: number;
	attachmentRefsSeen: number;
	attachmentTerminalUnavailable: number;
	attachmentTransientFailed: number;
	attachmentUploaded: number;
} {
	let attachmentReferenceOnly = 0;
	let attachmentRefsSeen = 0;
	let attachmentTerminalUnavailable = 0;
	let attachmentTransientFailed = 0;
	let attachmentUploaded = 0;
	for (const bundleRecord of bundleRecords) {
		attachmentRefsSeen += bundleRecord.notice_attachments.length;
		for (const attachment of bundleRecord.attachments) {
			if (
				attachment.storage_provider !== "reference_only" &&
				(attachment.ingest_status === "uploaded" || attachment.ingest_status === "downloaded")
			) {
				attachmentUploaded += 1;
				continue;
			}
			if (attachment.storage_provider === "reference_only") {
				attachmentReferenceOnly += 1;
			}
			const lastError = attachment.last_error ?? "";
			if (lastError.startsWith("terminal_unavailable:")) {
				attachmentTerminalUnavailable += 1;
			} else if (lastError.trim()) {
				attachmentTransientFailed += 1;
			}
		}
	}
	return {
		attachmentReferenceOnly,
		attachmentRefsSeen,
		attachmentTerminalUnavailable,
		attachmentTransientFailed,
		attachmentUploaded,
	};
}

export function aggregateRequiredNoticeAttachmentFacts(input: {
	admissions: AttachmentFetchAdmission[];
	bundleRecords: BundleNoticeRecord[];
}): {
	requiredSourceByteObjectCount: number;
	verifiedSourceByteObjectCount: number;
} {
	const requiredAdmissionKeys = new Set(
		input.admissions
			.filter((admission) => isRequiredSourceByteAdmission(admission))
			.map((admission) => attachmentFetchAdmissionKey(admission)),
	);
	if (requiredAdmissionKeys.size === 0) {
		return {
			requiredSourceByteObjectCount: 0,
			verifiedSourceByteObjectCount: 0,
		};
	}
	let verifiedSourceByteObjectCount = 0;
	for (const bundleRecord of input.bundleRecords) {
		const attachmentsById = new Map(
			bundleRecord.attachments.map((attachment) => [attachment.attachment_id, attachment]),
		);
		bundleRecord.notice_attachments.forEach((relation, index) => {
			const key = attachmentFetchAdmissionKey({
				attachmentRefId: `attachment-${String(index + 1).padStart(4, "0")}`,
				noticeId: String(bundleRecord.notice_id),
			});
			if (!requiredAdmissionKeys.has(key)) {
				return;
			}
			const attachment = attachmentsById.get(relation.attachment_id);
			if (
				attachment &&
				attachment.storage_provider !== "reference_only" &&
				(attachment.ingest_status === "uploaded" || attachment.ingest_status === "downloaded")
			) {
				verifiedSourceByteObjectCount += 1;
			}
		});
	}
	return {
		requiredSourceByteObjectCount: requiredAdmissionKeys.size,
		verifiedSourceByteObjectCount,
	};
}

export function aggregateReleasedFileFacts(bundleRecords: BundleFileReleaseRecord[]): {
	attachmentReferenceOnly: number;
	attachmentRefsSeen: number;
	attachmentTerminalUnavailable: number;
	attachmentTransientFailed: number;
	attachmentUploaded: number;
	sourceObjectsRequired: number;
} {
	let attachmentReferenceOnly = 0;
	let attachmentRefsSeen = 0;
	let attachmentTerminalUnavailable = 0;
	let attachmentTransientFailed = 0;
	let attachmentUploaded = 0;
	let sourceObjectsRequired = 0;
	for (const bundleRecord of bundleRecords) {
		attachmentRefsSeen += 1;
		const releasedFile = bundleRecord.released_file;
		if (releasedFile.origin_scope === "internal") {
			sourceObjectsRequired += 1;
		}
		if (
			releasedFile.storage_provider !== "reference_only" &&
			(releasedFile.ingest_status === "uploaded" || releasedFile.ingest_status === "downloaded")
		) {
			attachmentUploaded += 1;
			continue;
		}
		if (releasedFile.storage_provider === "reference_only") {
			attachmentReferenceOnly += 1;
		}
		const lastError = releasedFile.last_error ?? "";
		if (lastError.startsWith("terminal_unavailable:")) {
			attachmentTerminalUnavailable += 1;
		} else if (lastError.trim()) {
			attachmentTransientFailed += 1;
		}
	}
	return {
		attachmentReferenceOnly,
		attachmentRefsSeen,
		attachmentTerminalUnavailable,
		attachmentTransientFailed,
		attachmentUploaded,
		sourceObjectsRequired,
	};
}

function isRequiredSourceByteAdmission(admission: AttachmentFetchAdmission): boolean {
	return (
		admission.attachmentCapturePolicy === "fetch_required_for_source_truth" ||
		admission.attachmentCapturePolicy === "fetch_required_for_admitted_owner"
	);
}

function attachmentFetchAdmissionKey(input: { attachmentRefId: string; noticeId: string }): string {
	return `${input.noticeId}:${input.attachmentRefId}`;
}
