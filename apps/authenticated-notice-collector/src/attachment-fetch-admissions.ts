import type { AttachmentFetchAdmission } from "./attachment-materialization.js";
import { normalizeNullableText } from "./bootstrap-export-helpers.js";

export function parseAttachmentFetchAdmissionsFromManifest(
	manifest: unknown,
): AttachmentFetchAdmission[] {
	if (!isRecord(manifest)) {
		return [];
	}
	const requests = manifest.requests;
	if (!Array.isArray(requests)) {
		return [];
	}
	const admissions: AttachmentFetchAdmission[] = [];
	for (const request of requests) {
		const admission = parseAttachmentFetchAdmissionRequest(request);
		if (admission) {
			admissions.push(admission);
		}
	}
	return admissions;
}

function parseAttachmentFetchAdmissionRequest(request: unknown): AttachmentFetchAdmission | null {
	if (!isRecord(request)) {
		return null;
	}
	const nested = request.collector_admission;
	if (isRecord(nested)) {
		return normalizeAttachmentFetchAdmission({
			attachmentCapturePolicy: nested.attachmentCapturePolicy,
			attachmentRefId: nested.attachmentRefId,
			noticeId: nested.noticeId,
		});
	}
	return normalizeAttachmentFetchAdmission({
		attachmentCapturePolicy: request.attachment_capture_policy,
		attachmentRefId: request.attachment_ref_id,
		noticeId: request.notice_id,
	});
}

function normalizeAttachmentFetchAdmission(input: {
	attachmentCapturePolicy: unknown;
	attachmentRefId: unknown;
	noticeId: unknown;
}): AttachmentFetchAdmission | null {
	const attachmentCapturePolicy = normalizeFetchAttachmentCapturePolicy(
		input.attachmentCapturePolicy,
	);
	const attachmentRefId = normalizeUnknownText(input.attachmentRefId);
	const noticeId = normalizeUnknownText(input.noticeId);
	if (!(attachmentCapturePolicy && attachmentRefId && noticeId)) {
		return null;
	}
	return {
		attachmentCapturePolicy,
		attachmentRefId,
		noticeId,
	};
}

function normalizeFetchAttachmentCapturePolicy(
	value: unknown,
): AttachmentFetchAdmission["attachmentCapturePolicy"] | null {
	const normalized = normalizeUnknownText(value);
	if (
		normalized === "fetch_to_quarantine" ||
		normalized === "fetch_required_for_source_truth" ||
		normalized === "fetch_required_for_admitted_owner"
	) {
		return normalized;
	}
	return null;
}

function normalizeUnknownText(value: unknown): string | null {
	return typeof value === "string" ? normalizeNullableText(value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
