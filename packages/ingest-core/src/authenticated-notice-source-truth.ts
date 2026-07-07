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
	findMissingTransportScheduleAttachmentRefIds,
	resolveAuthenticatedNoticeRoutingSampleFromBundleRecord,
} from "./authenticated-notice-routing.ts";
import {
	applyAuthenticatedNoticeSourceRetention,
	buildAuthenticatedNoticeRetentionManifestFields,
	buildAuthenticatedNoticeSourceRetentionDecision,
	resolveAuthenticatedNoticeCaptureRoute,
} from "./authenticated-notice-source-retention.ts";
import {
	buildAuthenticatedNoticeAttachmentIdentity,
	buildAuthenticatedNoticeAttachmentRefs,
	buildAuthenticatedNoticeCanonicalDocumentArtifacts,
	buildAuthenticatedNoticeCaptureArtifacts,
	buildAuthenticatedNoticeContentBlocks,
	buildAuthenticatedNoticeOwnerExpectations,
	buildAuthenticatedNoticeProviderArtifacts,
	buildAuthenticatedNoticeSourceRootKeyFromManifestKey,
} from "./authenticated-notice-source-truth-artifacts.ts";
import {
	assertOptionalSha256Digest,
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
	task: IngestionTaskEnvelope;
}): Promise<IngestionArtifactRef[]> {
	const sourceInput = parseS3Uri(input.task.input_ref);
	const captureReleaseBytes = await input.objectStore.getObject(sourceInput);
	assertOptionalSha256Digest({
		actualSha256: sha256Hex(captureReleaseBytes),
		digest: input.task.input_ref.digest,
		label: "authenticated notice capture release input_ref",
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
				sourceBucket: sourceInput.bucket,
				task: input.task,
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
	sourceBucket: string;
	task: IngestionTaskEnvelope;
}): Promise<IngestionArtifactRef[]> {
	const notice = parseRecord(input.bundleRecord.notice, "bundle notice");
	const siteId = input.captureRelease.siteId;
	const noticeId = parseRequiredScalarText(
		notice.notice_id ?? input.bundleRecord.notice_id,
		"notice_id",
	);
	const title = parseRequiredText(notice.notice_title, "notice_title");
	const rawAssetId = `asset:authenticated-notice:${siteId}:${noticeId}`;
	const rawVersionId = buildCanonicalVersionDigest({
		attachments: buildAuthenticatedNoticeAttachmentIdentity(input.bundleRecord),
		categories: categoryPairs(notice),
		html: String(notice.notice_content ?? ""),
		title,
	});
	const year = inferYear(
		notice.notice_release_time ?? notice.notice_create_time ?? input.captureRelease.exportedAt,
	);
	const keys = buildAuthenticatedNoticeSourceTruthKeys({
		rawAssetId,
		rawVersionId,
		year,
	});
	const sourceRootKey = buildAuthenticatedNoticeSourceRootKeyFromManifestKey(keys.manifestKey);
	const sourceUri =
		parseOptionalText(notice.notice_link) ?? `campusnotice://${siteId}/notice/${noticeId}`;
	const sourceHomeUrl = parseRequiredText(input.exportManifest.source_home_url, "source_home_url");
	const contentBlocks = buildAuthenticatedNoticeContentBlocks({
		bundleRecord: input.bundleRecord,
		rawAssetId,
		rawVersionId,
		title,
		html: String(notice.notice_content ?? ""),
	});
	const rawAttachmentRefs = buildAuthenticatedNoticeAttachmentRefs({
		bundleRecord: input.bundleRecord,
		noticeId,
		rawAssetId,
		rawVersionId,
	});
	const routingSample = resolveAuthenticatedNoticeRoutingSampleFromBundleRecord({
		attachmentRefs: rawAttachmentRefs,
		bundleRecord: input.bundleRecord,
		config: input.noticeFamilyConfig,
	});
	const noticeCaptureRoute = resolveAuthenticatedNoticeCaptureRoute({
		suggestedConsumptionRoute: routingSample.suggestedConsumptionRoute,
	});
	const retentionDecision = buildAuthenticatedNoticeSourceRetentionDecision({
		attachmentRefs: rawAttachmentRefs,
		missingFactAttachmentRefIds: findMissingTransportScheduleAttachmentRefIds({
			attachmentRefs: rawAttachmentRefs,
			contentBlocks,
			routingSample,
		}),
		noticeCaptureRoute,
	});
	const attachmentRefs = applyAuthenticatedNoticeSourceRetention({
		attachmentRefs: rawAttachmentRefs,
		capturedAt: input.captureRelease.exportedAt,
		sourceRetentionDecision: retentionDecision,
	});
	const ownerExpectations = buildAuthenticatedNoticeOwnerExpectations({
		attachmentRefs,
		contentBlocks,
		title,
	});
	const categoryPairsForNotice = categoryPairs(notice);
	const manifest = {
		schema_version: MANIFEST_SCHEMA,
		source_channel: SOURCE_CHANNEL,
		site_id: siteId,
		notice_id: noticeId,
		raw_asset_id: rawAssetId,
		raw_version_id: rawVersionId,
		captured_at: input.captureRelease.exportedAt,
		list_observed_at: parseOptionalText(notice.last_seen_at) ?? input.captureRelease.exportedAt,
		detail_observed_at:
			parseOptionalText(notice.enrich_attempted_at) ?? input.captureRelease.exportedAt,
		fetcher_name: "authenticated_notice_capture_release_materializer",
		fetcher_version: String(input.exportManifest.schema_version ?? "unknown"),
		capture_runtime_version: captureRuntimeVersion(input.exportManifest),
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
		body_html_hash: sha256Hex(new TextEncoder().encode(String(notice.notice_content ?? ""))),
		block_count: contentBlocks.length,
		link_count: contentBlocks.filter((block) => block.block_role === "link").length,
		attachment_ref_count: attachmentRefs.length,
		...buildAuthenticatedNoticeRetentionManifestFields({
			attachmentRefs,
			noticeCaptureRoute,
		}),
		owner_expectation_count: ownerExpectations.length,
		owner_expectations: ownerExpectations,
		materialized_by_task_id: input.task.task_id,
	};
	const captureArtifacts = buildAuthenticatedNoticeCaptureArtifacts({
		bundleRecord: input.bundleRecord,
		exportManifest: input.exportManifest,
	});
	const providerArtifacts = buildAuthenticatedNoticeProviderArtifacts({
		bundleRecord: input.bundleRecord,
		categoryPairs: categoryPairsForNotice,
		notice,
	});
	const canonicalArtifacts = buildAuthenticatedNoticeCanonicalDocumentArtifacts({
		contentBlocks,
		documentId: `notice:${siteId}:${noticeId}`,
		sourceUri,
		title,
		versionId: rawVersionId,
	});
	return Promise.all([
		writeCanonicalJsonArtifact({
			bucket: input.sourceBucket,
			key: `${sourceRootKey}/capture/list-response.json`,
			objectStore: input.objectStore,
			value: captureArtifacts.listResponse,
		}),
		writeCanonicalJsonArtifact({
			bucket: input.sourceBucket,
			key: `${sourceRootKey}/capture/detail-response.json`,
			objectStore: input.objectStore,
			value: captureArtifacts.detailResponse,
		}),
		writeCanonicalJsonArtifact({
			bucket: input.sourceBucket,
			key: `${sourceRootKey}/capture/fetch-metadata.json`,
			objectStore: input.objectStore,
			value: captureArtifacts.fetchMetadata,
		}),
		writeCanonicalJsonArtifact({
			bucket: input.sourceBucket,
			key: `${sourceRootKey}/provider/normalized-notice.json`,
			objectStore: input.objectStore,
			value: providerArtifacts.normalizedNotice,
		}),
		writeCanonicalJsonLinesArtifact({
			bucket: input.sourceBucket,
			key: `${sourceRootKey}/provider/discovered-links.jsonl`,
			objectStore: input.objectStore,
			rows: providerArtifacts.discoveredLinks,
		}),
		writeCanonicalJsonLinesArtifact({
			bucket: input.sourceBucket,
			key: `${sourceRootKey}/provider/attachment-observations.jsonl`,
			objectStore: input.objectStore,
			rows: providerArtifacts.attachmentObservations,
		}),
		writeCanonicalJsonArtifact({
			bucket: input.sourceBucket,
			key: keys.manifestKey,
			objectStore: input.objectStore,
			value: manifest,
		}),
		writeCanonicalJsonLinesArtifact({
			bucket: input.sourceBucket,
			key: keys.contentBlocksKey,
			objectStore: input.objectStore,
			rows: contentBlocks,
		}),
		writeCanonicalJsonLinesArtifact({
			bucket: input.sourceBucket,
			key: keys.attachmentRefsKey,
			objectStore: input.objectStore,
			rows: attachmentRefs,
		}),
		writeUtf8Artifact({
			body: canonicalArtifacts.canonicalMarkdown,
			bucket: input.sourceBucket,
			contentType: "text/markdown; charset=utf-8",
			key: `${sourceRootKey}/canonical/canonical.md`,
			objectStore: input.objectStore,
		}),
		writeCanonicalJsonLinesArtifact({
			bucket: input.sourceBucket,
			key: `${sourceRootKey}/canonical/document-units.jsonl`,
			objectStore: input.objectStore,
			rows: canonicalArtifacts.documentUnits,
		}),
	]);
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

function captureRuntimeVersion(manifest: Record<string, unknown>): string {
	const captureRuntime = manifest.capture_runtime;
	if (isRecord(captureRuntime)) {
		return (
			parseOptionalText(captureRuntime.export_contract_version) ??
			parseOptionalText(captureRuntime.runtime_shell) ??
			String(manifest.schema_version ?? "unknown")
		);
	}
	return String(manifest.schema_version ?? "unknown");
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
