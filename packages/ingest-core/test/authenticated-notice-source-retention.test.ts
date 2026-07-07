import { describe, expect, it } from "vitest";
import {
	applyAuthenticatedNoticeSourceRetention,
	buildAuthenticatedNoticeRetentionManifestFields,
	buildAuthenticatedNoticeSourceRetentionDecision,
	resolveAuthenticatedNoticeCaptureRoute,
} from "../src/index.ts";

describe("authenticated notice source retention", () => {
	it("keeps notice-level query attachments as metadata only", () => {
		const decision = buildAuthenticatedNoticeSourceRetentionDecision({
			attachmentRefs: [
				attachmentRef("qr", { mime_type: "image/png" }),
				attachmentRef("guide", { mime_type: "application/zip" }),
				attachmentRef("summary", { mime_type: "application/vnd.ms-excel" }),
			],
			noticeCaptureRoute: "notice_level_query_only",
		});

		expect(decision).toMatchObject({
			attachmentCapturePolicyCounts: { metadata_only: 3 },
			metadataOnlyAttachmentRefCount: 3,
			noticeCaptureRoute: "notice_level_query_only",
			quarantineAttachmentRefCount: 0,
			requiredSourceObjectCount: 0,
		});
		expect(decision.attachmentDecisions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					attachmentCapturePolicy: "metadata_only",
					attachmentCaptureState: "metadata_recorded",
					byteFetchRequired: false,
					requiredSourceObject: false,
					retentionClass: "metadata_only",
				}),
			]),
		);
	});

	it("fetches missing service facts to quarantine without making them source truth", () => {
		const decision = buildAuthenticatedNoticeSourceRetentionDecision({
			attachmentRefs: [
				attachmentRef("schedule-table", { mime_type: "image/png" }),
				attachmentRef("supplemental-map", { mime_type: "image/png" }),
			],
			missingFactAttachmentRefIds: ["schedule-table"],
			noticeCaptureRoute: "candidate_service_fact",
		});

		expect(decision.requiredSourceObjectCount).toBe(0);
		expect(decision.quarantineAttachmentRefCount).toBe(1);
		expect(decisionById(decision, "schedule-table")).toMatchObject({
			attachmentCapturePolicy: "fetch_to_quarantine",
			attachmentCaptureState: "not_attempted",
			byteFetchRequired: true,
			requiredSourceObject: false,
			retentionClass: "quarantine_candidate",
		});
		expect(decisionById(decision, "supplemental-map")).toMatchObject({
			attachmentCapturePolicy: "metadata_only",
			retentionClass: "metadata_only",
		});
	});

	it("marks admitted document-owner attachments as required source objects only when bytes are collected", () => {
		const decision = buildAuthenticatedNoticeSourceRetentionDecision({
			attachmentRefs: [
				attachmentRef("released-file", {
					byte_size: 1024,
					content_sha256: "a".repeat(64),
					ingest_status: "uploaded",
					mime_type: "application/pdf",
					object_key: "internal_portal/files/released-file.pdf",
					storage_provider: "object_store",
				}),
			],
			noticeCaptureRoute: "candidate_document_owner",
			sourceTruthRequiredAttachmentRefIds: ["released-file"],
		});

		expect(decision.requiredSourceObjectCount).toBe(1);
		expect(decisionById(decision, "released-file")).toMatchObject({
			attachmentCapturePolicy: "fetch_required_for_source_truth",
			attachmentCaptureState: "uploaded_required",
			byteFetchRequired: false,
			requiredSourceObject: true,
			retentionClass: "permanent_source_truth",
		});

		const refs = applyAuthenticatedNoticeSourceRetention({
			attachmentRefs: [
				attachmentRef("released-file", {
					byte_size: 1024,
					content_sha256: "a".repeat(64),
					ingest_status: "uploaded",
					object_key: "internal_portal/files/released-file.pdf",
					storage_provider: "object_store",
				}),
			],
			capturedAt: "2026-04-04T01:23:45.000Z",
			sourceRetentionDecision: decision,
		});
		expect(
			buildAuthenticatedNoticeRetentionManifestFields({
				attachmentRefs: refs,
				noticeCaptureRoute: decision.noticeCaptureRoute,
			}),
		).toMatchObject({
			admitted_source_byte_ref_count: 0,
			required_source_object_count: 1,
			retention_class_counts: { permanent_source_truth: 1 },
		});
	});

	it("requires uploaded/downloaded status before treating object refs as collected bytes", () => {
		const decision = buildAuthenticatedNoticeSourceRetentionDecision({
			attachmentRefs: [
				attachmentRef("released-file", {
					byte_size: 1024,
					content_sha256: "a".repeat(64),
					mime_type: "application/pdf",
					object_key: "internal_portal/files/released-file.pdf",
					storage_provider: "object_store",
				}),
			],
			noticeCaptureRoute: "candidate_document_owner",
			sourceTruthRequiredAttachmentRefIds: ["released-file"],
		});

		expect(decisionById(decision, "released-file")).toMatchObject({
			attachmentCaptureState: "not_attempted",
			byteFetchRequired: true,
		});
	});

	it("maps suggested consumption routes to source capture routes", () => {
		expect(
			resolveAuthenticatedNoticeCaptureRoute({ suggestedConsumptionRoute: "notice_level_query" }),
		).toBe("notice_level_query_only");
		expect(
			resolveAuthenticatedNoticeCaptureRoute({
				suggestedConsumptionRoute: "service_status_candidate",
			}),
		).toBe("candidate_service_fact");
		expect(
			resolveAuthenticatedNoticeCaptureRoute({ suggestedConsumptionRoute: "regulation_candidate" }),
		).toBe("candidate_document_owner");
		expect(
			resolveAuthenticatedNoticeCaptureRoute({ suggestedConsumptionRoute: "no_adoption" }),
		).toBe("capture_only_no_adoption");
	});
});

function attachmentRef(
	id: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		attachment_ref_id: id,
		byte_size: null,
		content_sha256: null,
		ingest_status: null,
		last_error_class: null,
		mime_type: null,
		object_key: null,
		storage_provider: null,
		...overrides,
	};
}

function decisionById(
	decision: ReturnType<typeof buildAuthenticatedNoticeSourceRetentionDecision>,
	attachmentRefId: string,
) {
	const item = decision.attachmentDecisions.find(
		(candidate) => candidate.attachmentRefId === attachmentRefId,
	);
	if (!item) {
		throw new Error(`missing decision for ${attachmentRefId}`);
	}
	return item;
}
