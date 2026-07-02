// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("local dining preparation script", () => {
	it("keeps local dining readiness explicit and current-worktree scoped", () => {
		const source = readFileSync("scripts/prepare-local-dining.mjs", "utf8");

		expect(source).toContain("bootstrapSharedProductDatabase(process.env)");
		expect(source).toContain('src/cli.ts", "import-dev-seed"');
		expect(source).toContain("APP_API_OPERATOR_DATABASE_URL or DATABASE_URL is required");
		expect(source).toContain("stall_profile_id");
		expect(source).toContain("window_id");
		expect(source).toContain("haidian-canteen-2");
		expect(source).toContain("haidian-canteen-4");
		expect(source).toContain("local_dining_ready");
		expect(source).not.toContain(".worktrees");
		expect(source).not.toContain("resolveSourceRepoRoot");
	});
});
