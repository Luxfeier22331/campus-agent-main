import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	generatePublishedReaderProductionAcceptanceEvidence,
	type PublishedReaderProductionAcceptanceEvidence,
} from "../scripts/generate-published-reader-production-acceptance-evidence";
import { temporaryDirectories } from "./sync-real-docs-test-support";

function createTempDir(): string {
	const directory = mkdtempSync(join(tmpdir(), "public-docs-production-acceptance-"));
	temporaryDirectories.push(directory);
	return directory;
}

describe("published reader production acceptance evidence", () => {
	it("covers the required rolling publish acceptance matrix without real deploy side effects", async () => {
		const directory = createTempDir();
		const outputPath = join(directory, "acceptance.json");

		const evidence = await generatePublishedReaderProductionAcceptanceEvidence({
			now: "2026-04-29T12:00:00.000Z",
			outputPath,
		});

		expect(evidence.status).toBe("passed");
		expect(evidence.generatedAt).toBe("2026-04-29T12:00:00.000Z");
		expect(evidence.scenarios.map((scenario) => scenario.name)).toEqual([
			"prod_dry_run_changed_manifest",
			"staging_dry_run_changed_manifest",
			"no_change_skip",
			"changed_manifest_deploy",
			"invalid_manifest_blocks_deploy",
			"blocked_manifest_blocks_deploy",
			"lock_busy_blocks_deploy",
			"failed_command_records_failed_ledger",
			"rollback_dry_run",
			"hook_local_pipeline_nudge",
			"hook_cloudflare_dispatch",
		]);
		expect(evidence.scenarios.every((scenario) => scenario.passed)).toBe(true);
		expect(evidence.summary).toEqual({
			failed: 0,
			passed: 11,
			total: 11,
		});
		expect(
			evidence.scenarios.find((scenario) => scenario.name === "changed_manifest_deploy"),
		).toMatchObject({
			ledgerFinalStatus: "deployed",
			outcome: "deployed",
			trigger: "forced",
		});
		expect(
			evidence.scenarios.find((scenario) => scenario.name === "hook_local_pipeline_nudge"),
		).toMatchObject({
			outcome: "dry_run",
			trigger: "hook",
		});
		expect(
			evidence.scenarios.find((scenario) => scenario.name === "hook_cloudflare_dispatch"),
		).toMatchObject({
			deployHookStatus: 202,
			outcome: "dispatched",
		});

		expect(existsSync(outputPath)).toBe(true);
		expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual(
			evidence satisfies PublishedReaderProductionAcceptanceEvidence,
		);
	});
});
