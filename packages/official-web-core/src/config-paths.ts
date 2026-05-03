import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { OfficialWebConfigPaths } from "./config-models.ts";

function looksLikeRepoRoot(path: string): boolean {
	return (
		existsSync(resolve(path, "pnpm-workspace.yaml")) &&
		existsSync(resolve(path, "configs", "sources", "official_web"))
	);
}

function findRepoRoot(start: string): string | null {
	let current = resolve(start);
	while (true) {
		if (looksLikeRepoRoot(current)) {
			return current;
		}
		const parent = resolve(current, "..");
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

export function defaultRepoRoot(): string {
	const candidates = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
	for (const candidate of candidates) {
		const found = findRepoRoot(candidate);
		if (found) {
			return found;
		}
	}

	throw new Error("Unable to resolve campus-agent repo root from cwd or module path.");
}

export function defaultOfficialWebConfigRoot(repoRoot: string = defaultRepoRoot()): string {
	return resolve(repoRoot, "configs", "sources", "official_web");
}

export function resolveOfficialWebConfigPaths(
	siteId: string,
	options: { repoRoot?: string; configRoot?: string } = {},
): OfficialWebConfigPaths {
	const configRoot = options.configRoot ?? defaultOfficialWebConfigRoot(options.repoRoot);
	const siteRoot = resolve(configRoot, siteId);
	return {
		siteId,
		siteRoot,
		sitePath: resolve(siteRoot, "site.json"),
		hostsPath: resolve(siteRoot, "hosts.json"),
		seedsPath: resolve(siteRoot, "seeds.json"),
		crawlPolicyPath: resolve(siteRoot, "crawl-policy.json"),
		credentialsSchemaPath: resolve(siteRoot, "credentials.schema.json"),
		projectionDeclarationsPath: resolve(siteRoot, "projection-declarations.json"),
		consumerDenominatorPath: resolve(siteRoot, "consumer-denominator.json"),
		targetSourceMapPath: resolve(siteRoot, "target-source-map.json"),
		targetInventoryPath: resolve(siteRoot, "target-inventory.json"),
		sourcePackManifestPath: resolve(
			siteRoot,
			"source-packs",
			"tool-driven-first-slice.v1.json",
		),
		schedulerPolicyPath: resolve(siteRoot, "scheduler-policy.json"),
		qcPolicyPath: resolve(siteRoot, "qc-policy.json"),
	};
}
