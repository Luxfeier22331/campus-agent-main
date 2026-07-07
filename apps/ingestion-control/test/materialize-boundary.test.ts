import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("ingestion materialize handler boundaries", () => {
	it("keeps source-truth handler assembly in ingestion-control runtime", () => {
		const source = readFileSync(
			join(import.meta.dirname, "..", "src", "source-truth-handlers.ts"),
			"utf8",
		);

		expect(source).toContain("createAuthenticatedNoticeSourceTruthMaterializeHandler");
		expect(source).toContain("createOfficialWebSourceTruthMaterializeHandler");
	});

	it("keeps JSON canonicalization and source-channel parsing in ingest-core", () => {
		const offenders: string[] = [];
		for (const fileName of ["index.ts", "rust-kernel-runner.ts", "temporal-worker.ts"]) {
			const source = readFileSync(join(import.meta.dirname, "..", "src", fileName), "utf8");
			for (const forbidden of [
				"authenticated-notice-materialize",
				"authenticated-file-release-materialize",
				"official-web-materialize",
				"wechat-official-account-materialize",
				"jsonStableBytes",
				"objectKeySorter",
				"sortJsonValue",
				"canonicalJsonReplacer",
				"function asRecord",
				"function requiredText",
				"function optionalText",
				"function writeJsonArtifact",
				"function writeJsonlArtifact",
				"function writeArtifact",
				"function validateCaptureRelease",
				"function validateExportManifest",
				"function fileReleaseBundleKeyForManifest",
				"function sourceTruthPrefix",
				"function sourceAssetSlug",
				"function identitySegments",
				"function asOfficialWebSourceTruthBundle",
				"captureRelease.site_id",
				"captureRelease.exported_at",
				"function requireKernelOutputJson",
				"function rustKernelArtifactKey",
				"function safeKeySegment",
				"parsed.schema_version",
				"stdout must be a JSON object",
				"JSON.parse(",
			]) {
				if (source.includes(forbidden)) {
					offenders.push(`${fileName}: ${forbidden}`);
				}
			}
			if (source.includes("JSON.stringify(")) {
				offenders.push(`${fileName}: JSON.stringify(`);
			}
		}

		expect(offenders).toEqual([]);
	});

	it("does not export runtime handler factories or dispatchers from ingest-core", () => {
		const source = readFileSync(
			join(import.meta.dirname, "..", "..", "..", "packages", "ingest-core", "src", "index.ts"),
			"utf8",
		);

		expect(source).not.toContain("createAuthenticatedNoticeSourceTruthMaterializeHandler");
		expect(source).not.toContain("createOfficialWebSourceTruthMaterializeHandler");
		expect(source).not.toContain("runDeclaredIngestionTask");
		expect(source).not.toContain("TsTaskHandlerRegistry");
		expect(source).not.toContain("RustKernelRegistry");
	});
});
