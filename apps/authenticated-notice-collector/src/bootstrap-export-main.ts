import fs from "node:fs";

import { createAuthenticatedNoticeArtifactStoreFromEnv } from "./artifact-store.js";
import { parseAttachmentFetchAdmissionsFromManifest } from "./attachment-fetch-admissions.js";
import type { AttachmentFetchAdmission } from "./attachment-materialization.js";
import {
	collectBootstrapBundle,
	parseSelectedNoticeSpecs,
	runBootstrapExport,
} from "./bootstrap-export-core.js";
import { toTimestampLabel } from "./bootstrap-export-helpers.js";
import {
	buildAttachmentFetchStatusStoreForMain,
	buildCollectorRunLeaseStoreForMain,
	buildCollectorRunLedgerStoreForMain,
} from "./bootstrap-export-runtime-stores.js";
import { buildCollectorRunLeaseKey } from "./collector-run-lease.js";
import { runWithOptionalCollectorLease } from "./collector-runtime.js";
import {
	type CollectorConfig,
	ensureRuntimeDirs,
	loadCollectorEnv,
	resolveCollectorConfig,
} from "./config.js";
import * as noticeTypeConfig from "./notice-types.js";

export async function main(): Promise<void> {
	loadCollectorEnv();
	const config = resolveCollectorConfig(process.env);
	ensureRuntimeDirs(config);
	const noticeTypes = noticeTypeConfig.applyNoticeTypeAllowlist(
		noticeTypeConfig.loadNoticeTypes(config.noticeTypesPath),
		config.noticeTypeAllowlist,
	);
	const exportedAt = new Date().toISOString();
	const attachmentArtifactStore = createAuthenticatedNoticeArtifactStoreFromEnv(process.env);
	const attachmentFetchAdmissions = loadAttachmentFetchAdmissionsForMain(config);
	const attachmentFetchStatusStore = buildAttachmentFetchStatusStoreForMain(config);
	const collectorRunLedgerStore = buildCollectorRunLedgerStoreForMain(config);
	const collectorRunLeaseStore = buildCollectorRunLeaseStoreForMain(config);
	try {
		await runWithOptionalCollectorLease(
			collectorRunLeaseStore,
			{
				leaseKey: buildCollectorRunLeaseKey({
					siteId: config.siteId,
					sourceSurface: "notice",
				}),
				now: exportedAt,
				ownerId: `${config.siteId}:notice:${toTimestampLabel(exportedAt)}`,
				ttlSeconds: config.collectorRunLeaseTtlSeconds,
			},
			async () => {
				const selectedNotices = parseSelectedNoticeSpecs(
					process.env.AUTHENTICATED_NOTICE_SELECTED_NOTICES,
				);
				const runResult = await runBootstrapExport({
					artifactStore: attachmentArtifactStore,
					attachmentFetchAdmissions,
					collectBundle: () =>
						collectBootstrapBundle({
							attachmentArtifactStore,
							attachmentFetchStatusStore,
							collectionMode: config.collectionMode,
							exportedAt,
							noticeTypes,
							requestBackoffBaseMs: config.requestBackoffBaseMs,
							requestMaxRetries: config.requestMaxRetries,
							attachmentFetchAdmissions,
							defaultInlineVisualCapture: config.defaultInlineVisualCapture,
							backfillMaxPagesPerType: config.historicalBackfillMaxPagesPerType,
							selectedNotices,
							siteId: config.siteId,
							sourceHomeUrl: config.sourceHomeUrl,
						}),
					collectionMode: config.collectionMode,
					collectorRunLedgerStore,
					exportedAt,
					outputDir: config.exportsDir,
					siteId: config.siteId,
					sourceHomeUrl: config.sourceHomeUrl,
					writeLocalArtifacts: config.writeLocalExports,
				});
				console.log(
					JSON.stringify(
						{
							...runResult.result.stats,
							bundlePath: runResult.written?.bundlePath ?? null,
							bundleObjectKey: runResult.uploadedArtifactRefs.bundleObjectKey,
							captureReleaseObjectKey: runResult.uploadedArtifactRefs.captureReleaseObjectKey,
							manifestPath: runResult.written?.manifestPath ?? null,
							manifestObjectKey: runResult.uploadedArtifactRefs.manifestObjectKey,
						},
						null,
						2,
					),
				);
			},
		);
	} finally {
		await attachmentFetchStatusStore?.dispose();
		await collectorRunLedgerStore?.dispose();
		await collectorRunLeaseStore?.dispose();
	}
}

function loadAttachmentFetchAdmissionsForMain(config: CollectorConfig): AttachmentFetchAdmission[] {
	if (config.attachmentFetchRequestManifestPath === null) {
		return [];
	}
	const raw = fs.readFileSync(config.attachmentFetchRequestManifestPath, "utf-8");
	return parseAttachmentFetchAdmissionsFromManifest(JSON.parse(raw));
}
