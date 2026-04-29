import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = resolve(
	import.meta.dirname,
	"../../../.github/workflows/public-docs-rolling-publish.yml",
);

describe("public docs rolling publish workflow", () => {
	it("defines a controlled scheduled publish workflow with explicit gates", () => {
		const workflow = readFileSync(WORKFLOW_PATH, "utf8");
		const manualDispatchCondition = [
			'if [ "',
			"$",
			'{{ github.event_name }}" = "workflow_dispatch" ]; then',
		].join("");

		expect(workflow).toContain("name: public-docs-rolling-publish");
		expect(workflow).toContain('cron: "7 4,10,16,22 * * *"');
		expect(workflow).toContain("workflow_dispatch:");
		expect(workflow).toContain("concurrency:");
		expect(workflow).toContain("public-docs-rolling-publish-");
		expect(workflow).toContain("PUBLIC_DOCS_ROLLING_PUBLISH_ENABLED");
		expect(workflow).toContain("PUBLIC_DOCS_ROLLING_PUBLISH_DRY_RUN");
		expect(workflow).toContain("PUBLIC_DOCS_SYNC_MANIFEST_KEY");
		expect(workflow).toContain("PUBLIC_DOCS_RELEASE_LEDGER_KEY");
		expect(workflow).toContain("pnpm --filter public-docs acceptance:published-reader-production");
		expect(workflow).toContain("pnpm --filter public-docs publish:rolling");
		expect(workflow).toContain(manualDispatchCondition);
		expect(workflow).toContain("args+=(--no-dry-run)");
		expect(workflow).toContain("args+=(--dry-run)");
		expect(workflow).toContain("actions/upload-artifact@v4");
		expect(workflow).toContain("public-docs-publish-result.json");
		expect(workflow).toContain("public-docs-production-acceptance.json");
	});
});
