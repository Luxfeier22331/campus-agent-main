import { createAuthenticatedNoticeArtifactStoreFromEnv } from "./artifact-store.js";
import { buildCollectorRunLeaseKey } from "./collector-run-lease.js";
import { runWithOptionalCollectorLease } from "./collector-runtime.js";
import { ensureRuntimeDirs, loadCollectorEnv, resolveCollectorConfig } from "./config.js";
import { collectFileReleaseBundle, runFileReleaseExport } from "./file-release-export-core.js";
import {
	resolveFileReleaseExportFiltersFromEnv,
	toTimestampLabel,
} from "./file-release-export-helpers.js";
import {
	buildCollectorRunLeaseStoreForMain,
	buildCollectorRunLedgerStoreForMain,
} from "./file-release-export-runtime.js";

export async function main(): Promise<void> {
	loadCollectorEnv();
	const config = resolveCollectorConfig(process.env);
	ensureRuntimeDirs(config);
	const exportedAt = new Date().toISOString();
	const attachmentArtifactStore = createAuthenticatedNoticeArtifactStoreFromEnv(process.env);
	const collectorRunLedgerStore = buildCollectorRunLedgerStoreForMain(config);
	const collectorRunLeaseStore = buildCollectorRunLeaseStoreForMain(config);
	const { pageSize, maxPages, maxFileReleases, targetFileReleaseId } =
		resolveFileReleaseExportFiltersFromEnv(process.env);
	try {
		await runWithOptionalCollectorLease(
			collectorRunLeaseStore,
			{
				leaseKey: buildCollectorRunLeaseKey({
					siteId: config.siteId,
					sourceSurface: "file_release",
				}),
				now: exportedAt,
				ownerId: `${config.siteId}:file_release:${toTimestampLabel(exportedAt)}`,
				ttlSeconds: config.collectorRunLeaseTtlSeconds,
			},
			async () => {
				const runResult = await runFileReleaseExport({
					artifactStore: attachmentArtifactStore,
					collectBundle: () =>
						collectFileReleaseBundle({
							attachmentArtifactStore,
							exportedAt,
							maxFileReleases,
							maxPages,
							pageSize,
							requestMaxRetries: config.requestMaxRetries,
							siteId: config.siteId,
							sourceHomeUrl: config.sourceHomeUrl,
							targetFileReleaseId,
						}),
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
		await collectorRunLedgerStore?.dispose();
		await collectorRunLeaseStore?.dispose();
	}
}
