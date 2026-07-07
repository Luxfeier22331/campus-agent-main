export * from "./visual-ref-audit-core.js";

import path from "node:path";
import {
	ensureRuntimeDirs,
	type InternalPortalConfig,
	loadInternalPortalEnv,
	resolveInternalPortalConfig,
} from "./config.js";
import { parseSelectedNoticeSpecs } from "./notice-export-core.js";
import { toTimestampLabel } from "./notice-export-helpers.js";
import { applyNoticeTypeAllowlist, loadNoticeTypes } from "./notice-types.js";
import { formatSafeErrorMessage } from "./safe-error.js";
import {
	collectVisualReferenceAudit,
	writeVisualReferenceAuditReport,
} from "./visual-ref-audit-core.js";

const DEFAULT_AUDIT_MAX_NOTICES = 50;

export async function main(): Promise<void> {
	loadInternalPortalEnv();
	const config = resolveInternalPortalConfig(process.env);
	ensureRuntimeDirs(config);
	const generatedAt = new Date().toISOString();
	const selectedNotices = parseSelectedNoticeSpecs(process.env.INTERNAL_PORTAL_SELECTED_NOTICES);
	const maxNotices =
		selectedNotices.length > 0
			? undefined
			: parsePositiveInteger(
					process.env.INTERNAL_PORTAL_VISUAL_AUDIT_MAX_NOTICES,
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

function resolveVisualAuditOutputDir(config: InternalPortalConfig, generatedAt: string): string {
	const explicit = String(process.env.INTERNAL_PORTAL_VISUAL_AUDIT_OUTPUT_DIR ?? "").trim();
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

function parsePositiveInteger(raw: string | undefined, defaultValue: number): number {
	const parsed = Number(raw || "");
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return defaultValue;
	}
	return Math.floor(parsed);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
