export * from "./visual-ref-audit-core";

import path from "node:path";

import { parseSelectedNoticeSpecs } from "./bootstrap-export-core";
import { toTimestampLabel } from "./bootstrap-export-helpers";
import {
	type CollectorConfig,
	ensureRuntimeDirs,
	loadCollectorEnv,
	resolveCollectorConfig,
} from "./config";
import { applyNoticeTypeAllowlist, loadNoticeTypes } from "./notice-types";
import { formatSafeErrorMessage } from "./safe-error";
import {
	collectVisualReferenceAudit,
	writeVisualReferenceAuditReport,
} from "./visual-ref-audit-core";

const DEFAULT_AUDIT_MAX_NOTICES = 50;

export async function main(): Promise<void> {
	loadCollectorEnv();
	const config = resolveCollectorConfig(process.env);
	ensureRuntimeDirs(config);
	const generatedAt = new Date().toISOString();
	const selectedNotices = parseSelectedNoticeSpecs(
		process.env.AUTHENTICATED_NOTICE_SELECTED_NOTICES,
	);
	const maxNotices =
		selectedNotices.length > 0
			? undefined
			: parsePositiveInteger(
					process.env.AUTHENTICATED_NOTICE_VISUAL_AUDIT_MAX_NOTICES,
					DEFAULT_AUDIT_MAX_NOTICES,
				);
	const report = await collectVisualReferenceAudit({
		collectionMode: config.collectionMode,
		generatedAt,
		maxNotices,
		noticeTypes: applyNoticeTypeAllowlist(
			loadNoticeTypes(config.noticeTypesPath),
			config.noticeTypeAllowlist,
		),
		requestBackoffBaseMs: config.requestBackoffBaseMs,
		requestMaxRetries: config.requestMaxRetries,
		selectedNotices,
		siteId: config.siteId,
		sourceHomeUrl: config.sourceHomeUrl,
	});
	const written = writeVisualReferenceAuditReport({
		outputDir: resolveVisualAuditOutputDir(config, generatedAt),
		report,
	});
	console.log(
		JSON.stringify(
			{
				ok: true,
				reportPath: written.reportPath,
				summary: report.summary,
			},
			null,
			2,
		),
	);
}

function resolveVisualAuditOutputDir(config: CollectorConfig, generatedAt: string): string {
	const explicit = String(process.env.AUTHENTICATED_NOTICE_VISUAL_AUDIT_OUTPUT_DIR ?? "").trim();
	if (explicit) {
		return path.resolve(explicit);
	}
	return path.join(
		config.repoRoot,
		".tmp",
		"authenticated-notice-visual-audit",
		toTimestampLabel(generatedAt),
	);
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
	const parsed = Number(raw || "");
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}
	return Math.floor(parsed);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
