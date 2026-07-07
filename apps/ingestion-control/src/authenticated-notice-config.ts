import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	type AuthenticatedNoticeNoticeFamilyConfig,
	parseAuthenticatedNoticeNoticeFamilyConfig,
} from "ingest-core";

export function loadAuthenticatedNoticeFamilyConfigFromRegistryRoot(
	registryRoot: string,
): AuthenticatedNoticeNoticeFamilyConfig {
	const root = registryRoot.trim();
	if (!root) {
		throw new Error("INGESTION_TASK_REGISTRY_ROOT is required for authenticated notice config");
	}
	const path = join(
		root,
		"campus_notices",
		"internal_notice",
		"notice-family-classification.v1.json",
	);
	const payload = JSON.parse(readFileSync(path, "utf8")) as unknown;
	return parseAuthenticatedNoticeNoticeFamilyConfig(payload);
}
