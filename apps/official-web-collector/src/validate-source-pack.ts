import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadOfficialWebConfig } from "official-web-core";
import { normalizeCliArgs } from "./cli.ts";

export interface SourcePackValidationEntryReport {
	entryId: string;
	ownerSurfaceCount: number;
	releaseTargetCount: number;
	url: string;
}

export interface SourcePackValidationReport {
	entryCount: number;
	entries: SourcePackValidationEntryReport[];
	siteId: string;
	sourcePackId: string;
	valid: true;
}

export function validateSourcePackConfig(
	siteId: string,
	options: { configRoot?: string; repoRoot?: string } = {},
): SourcePackValidationReport {
	const config = loadOfficialWebConfig(siteId, options);
	return {
		valid: true,
		siteId: config.sourcePackManifest.siteId,
		sourcePackId: config.sourcePackManifest.sourcePackId,
		entryCount: config.sourcePackManifest.entries.length,
		entries: config.sourcePackManifest.entries.map((entry) => ({
			entryId: entry.entryId,
			ownerSurfaceCount: entry.ownerSurfaces.length,
			releaseTargetCount: entry.releaseTargets.length,
			url: entry.url,
		})),
	};
}

export function validateSourcePackMain(argv: string[] = process.argv.slice(2)): void {
	const { values } = parseArgs({
		args: normalizeCliArgs(argv),
		options: {
			"site-id": { type: "string" },
			"repo-root": { type: "string" },
			"config-root": { type: "string" },
		},
		allowPositionals: false,
	});

	const siteId = values["site-id"];
	if (typeof siteId !== "string" || siteId.length === 0) {
		throw new Error("--site-id is required");
	}

	const report = validateSourcePackConfig(siteId, {
		repoRoot: values["repo-root"],
		configRoot: values["config-root"],
	});
	console.log(JSON.stringify(report, null, 2));
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
	validateSourcePackMain();
}
