import type { IngestionArtifactRef, IngestionTaskEnvelope } from "ingestion-contracts";

import {
	buildAuthenticatedNoticeSourceTruthKeys,
	buildCanonicalVersionDigest,
	writeCanonicalJsonArtifact,
	writeCanonicalJsonLinesArtifact,
	writeUtf8Artifact,
} from "./artifacts.ts";
import {
	type AuthenticatedNoticeNoticeFamilyConfig,
	resolveAuthenticatedNoticeRoutingSampleFromBundleRecord,
} from "./authenticated-notice-routing.ts";
import {
	buildAuthenticatedNoticeAttachmentIdentity,
	buildAuthenticatedNoticeAttachmentRefs,
	buildAuthenticatedNoticeCanonicalDocumentArtifacts,
	buildAuthenticatedNoticeContentBlocks,
	buildAuthenticatedNoticeOwnerExpectations,
	buildAuthenticatedNoticeSourceRootKeyFromManifestKey,
} from "./authenticated-notice-source-truth-artifacts.ts";
import {
	assertArtifactRefBytes,
	type ObjectStore,
	parseJsonArrayBytes,
	parseJsonObjectBytes,
	parseOptionalText,
	parseRecord,
	parseRequiredScalarText,
	parseRequiredText,
	parseS3Uri,
	sha256Hex,
} from "./core.ts";
import {
	type AuthenticatedNoticeCaptureRelease,
	assertObjectRefsUseBucket,
	parseAuthenticatedNoticeCaptureRelease,
} from "./source-handoff.ts";

const SOURCE_CHANNEL = "internal_portal";
const MANIFEST_SCHEMA = "authenticated_notice_manifest_v1";

export async function materializeAuthenticatedNoticeSourceTruthFromTask(input: {
	noticeFamilyConfig: AuthenticatedNoticeNoticeFamilyConfig;
	objectStore: ObjectStore;
	outputBucket: string;
	task: IngestionTaskEnvelope;
}): Promise<IngestionArtifactRef[]> {
	const sourceInput = parseS3Uri(input.task.input_ref);
	const captureReleaseBytes = await input.objectStore.getObject(sourceInput);
	assertArtifactRefBytes({
		bytes: captureReleaseBytes,
		label: "authenticated notice capture release input_ref",
		ref: input.task.input_ref,
	});
	const captureRelease = parseJsonObjectBytes(captureReleaseBytes, "capture release");
	const parsedCaptureRelease = parseAuthenticatedNoticeCaptureRelease(captureRelease);
	assertObjectRefsUseBucket(
		[parsedCaptureRelease.bundleRef, parsedCaptureRelease.exportManifestRef],
		sourceInput.bucket,
		"capture release object refs must use the source bucket",
	);
	const bundleBytes = await input.objectStore.getObject({
		bucket: parsedCaptureRelease.bundleRef.bucket,
		key: parsedCaptureRelease.bundleRef.key,
	});
	const manifestBytes = await input.objectStore.getObject({
		bucket: parsedCaptureRelease.exportManifestRef.bucket,
		key: parsedCaptureRelease.exportManifestRef.key,
	});
	verifyObjectRefBytes(parsedCaptureRelease.bundleRef, bundleBytes, "bundle_ref");
	verifyObjectRefBytes(
		parsedCaptureRelease.exportManifestRef,
		manifestBytes,
		"export_manifest_ref",
	);
	const bundleRecords = parseJsonArrayBytes(bundleBytes, "notices bundle").map((item) =>
		parseRecord(item, "notices bundle record"),
	);
	const exportManifest = parseJsonObjectBytes(manifestBytes, "export manifest");
	const refs: IngestionArtifactRef[] = [];
	for (const bundleRecord of bundleRecords) {
		refs.push(
			...(await materializeNoticeSourceTruth({
				bundleRecord,
				captureRelease: parsedCaptureRelease,
				exportManifest,
				noticeFamilyConfig: input.noticeFamilyConfig,
				objectStore: input.objectStore,
				outputBucket: input.outputBucket,
			})),
		);
	}
	return refs;
}

async function materializeNoticeSourceTruth(input: {
	bundleRecord: Record<string, unknown>;
	captureRelease: AuthenticatedNoticeCaptureRelease;
	exportManifest: Record<string, unknown>;
	noticeFamilyConfig: AuthenticatedNoticeNoticeFamilyConfig;
	objectStore: ObjectStore;
	outputBucket: string;
}): Promise<IngestionArtifactRef[]> {
	const notice = parseRecord(input.bundleRecord.notice, "bundle notice");
	const siteId = input.captureRelease.siteId;
	const noticeId = parseRequiredScalarText(
		notice.notice_id ?? input.bundleRecord.notice_id,
		"notice_id",
	);
	const title = parseRequiredText(notice.notice_title, "notice_title");
	const rawAssetId = `asset:authenticated-notice:${siteId}:${noticeId}`;
	const html = String(notice.notice_content ?? "");
	const sourceUri =
		parseOptionalText(notice.notice_link) ?? `campusnotice://${siteId}/notice/${noticeId}`;
	const provisionalContentBlocks = buildAuthenticatedNoticeContentBlocks({
		bundleRecord: input.bundleRecord,
		html,
		rawAssetId,
		rawVersionId: "pending",
		title,
	});
	const categoryPairsForNotice = categoryPairs(notice);
	const rawVersionId = buildCanonicalVersionDigest({
		attachments: buildAuthenticatedNoticeAttachmentIdentity(input.bundleRecord),
		categories: categoryPairsForNotice,
		content_blocks: contentBlockIdentity(provisionalContentBlocks),
		notice: {
			organization_id: parseOptionalText(notice.organization_id),
			organization_name: parseOptionalText(notice.organization_name),
			notice_create_time: parseOptionalText(notice.notice_create_time),
			notice_first_time: parseOptionalText(notice.notice_first_time),
			notice_link_state: notice.notice_link_state ?? null,
			notice_release_time: parseOptionalText(notice.notice_release_time),
			notice_source: notice.notice_source ?? null,
			notice_state: notice.notice_state ?? null,
			notice_stick: notice.notice_stick ?? null,
			source_uri: sourceUri,
			title,
		},
	});
	const year = inferYear(notice.notice_release_time ?? notice.notice_create_time);
	const keys = buildAuthenticatedNoticeSourceTruthKeys({
		rawAssetId,
		rawVersionId,
		year,
	});
	const sourceRootKey = buildAuthenticatedNoticeSourceRootKeyFromManifestKey(keys.manifestKey);
	const sourceHomeUrl = parseRequiredText(input.exportManifest.source_home_url, "source_home_url");
	const contentBlocks = buildAuthenticatedNoticeContentBlocks({
		bundleRecord: input.bundleRecord,
		rawAssetId,
		rawVersionId,
		title,
		html,
	});
	const rawAttachmentRefs = buildAuthenticatedNoticeAttachmentRefs({
		bundleRecord: input.bundleRecord,
		noticeId,
		rawAssetId,
		rawVersionId,
	});
	assertAuthenticatedNoticeAttachmentsPublishable(rawAttachmentRefs);
	const routingSample = resolveAuthenticatedNoticeRoutingSampleFromBundleRecord({
		attachmentRefs: rawAttachmentRefs,
		bundleRecord: input.bundleRecord,
		config: input.noticeFamilyConfig,
	});
	const attachmentRefs = rawAttachmentRefs;
	const ownerExpectations = buildAuthenticatedNoticeOwnerExpectations({
		attachmentRefs,
		contentBlocks,
		title,
	});
	const manifest = {
		schema_version: MANIFEST_SCHEMA,
		source_channel: SOURCE_CHANNEL,
		site_id: siteId,
		notice_id: noticeId,
		raw_asset_id: rawAssetId,
		raw_version_id: rawVersionId,
		credentials_mode: "authenticated",
		notice_title_raw: title,
		notice_title_normalized: title,
		organization_name: parseOptionalText(notice.organization_name),
		organization_id: parseOptionalText(notice.organization_id),
		notice_release_time: parseOptionalText(notice.notice_release_time),
		notice_create_time: parseOptionalText(notice.notice_create_time),
		notice_first_time: parseOptionalText(notice.notice_first_time),
		notice_source: notice.notice_source ?? null,
		notice_link_state: notice.notice_link_state ?? null,
		notice_state: notice.notice_state ?? null,
		notice_stick: notice.notice_stick ?? null,
		notice_type_ids: categoryPairsForNotice.map(([id]) => id),
		notice_type_names: categoryPairsForNotice.map(([, name]) => name),
		source_notice_link: sourceUri,
		source_home_url: sourceHomeUrl,
		portal_print_url: parseOptionalText(notice.portal_print_url),
		notice_browser_url: parseOptionalText(notice.notice_browser_url),
		notice_browser_url_source: parseOptionalText(notice.notice_browser_url_source),
		notice_family: routingSample.noticeFamily,
		notice_family_admission_policy: routingSample.admissionPolicy,
		notice_family_priority: routingSample.priority,
		notice_suggested_consumption_route: routingSample.suggestedConsumptionRoute,
		notice_machine_processing_policy: routingSample.machineProcessingPolicy,
		notice_attachment_processing_policy: routingSample.attachmentProcessingPolicy,
		notice_attachment_processing_reason: routingSample.attachmentProcessingReason,
		notice_family_matched_title_patterns: routingSample.matchedTitlePatterns,
		notice_family_matched_body_patterns: routingSample.matchedBodyPatterns,
		body_html_hash: sha256Hex(new TextEncoder().encode(html)),
		block_count: contentBlocks.length,
		link_count: contentBlocks.filter((block) => block.block_role === "link").length,
		attachment_ref_count: attachmentRefs.length,
		owner_expectation_count: ownerExpectations.length,
		owner_expectations: ownerExpectations,
	};
	const canonicalArtifacts = buildAuthenticatedNoticeCanonicalDocumentArtifacts({
		contentBlocks,
		documentId: `notice:${siteId}:${noticeId}`,
		sourceUri,
		title,
		versionId: rawVersionId,
	});
	return Promise.all([
		writeCanonicalJsonArtifact({
			bucket: input.outputBucket,
			key: keys.manifestKey,
			objectStore: input.objectStore,
			value: manifest,
		}),
		writeCanonicalJsonLinesArtifact({
			bucket: input.outputBucket,
			key: keys.contentBlocksKey,
			objectStore: input.objectStore,
			rows: contentBlocks,
		}),
		writeCanonicalJsonLinesArtifact({
			bucket: input.outputBucket,
			key: keys.attachmentRefsKey,
			objectStore: input.objectStore,
			rows: attachmentRefs,
		}),
		writeUtf8Artifact({
			body: canonicalArtifacts.canonicalMarkdown,
			bucket: input.outputBucket,
			contentType: "text/markdown; charset=utf-8",
			key: `${sourceRootKey}/canonical/canonical.md`,
			objectStore: input.objectStore,
		}),
		writeCanonicalJsonLinesArtifact({
			bucket: input.outputBucket,
			key: `${sourceRootKey}/canonical/document-units.jsonl`,
			objectStore: input.objectStore,
			rows: canonicalArtifacts.documentUnits,
		}),
	]);
}

function assertAuthenticatedNoticeAttachmentsPublishable(
	attachmentRefs: readonly Record<string, unknown>[],
): void {
	for (const attachment of attachmentRefs) {
		if (parseOptionalText(attachment.origin_scope) !== "internal") {
			continue;
		}
		const attachmentRefId = parseRequiredText(attachment.attachment_ref_id, "attachment_ref_id");
		const terminalReason = parseOptionalText(attachment.terminal_reason);
		const isTerminalUnavailable =
			parseOptionalText(attachment.ingest_status) === "terminal_unavailable" &&
			(terminalReason === "http_404" || terminalReason === "http_410");
		const byteSize = attachment.byte_size;
		const isObjectBacked =
			parseOptionalText(attachment.storage_provider) === "object_store" &&
			parseOptionalText(attachment.bucket) !== null &&
			parseOptionalText(attachment.object_key) !== null &&
			parseOptionalText(attachment.content_sha256) !== null &&
			typeof byteSize === "number" &&
			Number.isSafeInteger(byteSize) &&
			byteSize >= 0;
		if (!(isTerminalUnavailable || isObjectBacked)) {
			throw new Error(
				`authenticated notice internal attachment is not publishable: ${attachmentRefId}`,
			);
		}
	}
}

function verifyObjectRefBytes(
	ref: { contentSha256: string | null; byteSize: number | null },
	bytes: Uint8Array,
	label: string,
): void {
	if (ref.byteSize !== null && ref.byteSize !== bytes.byteLength) {
		throw new Error(`${label} byte_size mismatch`);
	}
	if (ref.contentSha256 !== null && ref.contentSha256 !== sha256Hex(bytes)) {
		throw new Error(`${label} content_sha256 mismatch`);
	}
}

function categoryPairs(notice: Record<string, unknown>): [string, string][] {
	return arrayOrEmpty(notice.categories)
		.filter(isRecord)
		.flatMap((category) => {
			const id = String(category.notice_type ?? "").trim();
			const name = String(category.notice_type_name ?? "").trim();
			return id || name ? [[id, name] as [string, string]] : [];
		});
}

function contentBlockIdentity(blocks: readonly Record<string, unknown>[]): unknown[] {
	return blocks.map((block) => ({
		block_role: block.block_role ?? null,
		heading_level: block.heading_level ?? null,
		link_target: block.link_target ?? null,
		list_level: block.list_level ?? null,
		table_cells: block.table_cells ?? null,
		text_normalized: block.text_normalized ?? null,
	}));
}

function inferYear(value: unknown): string | null {
	const match = String(value ?? "").match(/(?<!\d)((?:19|20)\d{2})(?!\d)/u);
	return match?.[1] ?? null;
}

function arrayOrEmpty(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
