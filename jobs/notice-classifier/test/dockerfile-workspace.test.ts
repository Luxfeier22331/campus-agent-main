import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");
const dockerfile = readFileSync(join(repoRoot, "jobs/notice-classifier/Dockerfile"), "utf8");

describe("notice-classifier Dockerfile workspace inputs", () => {
	it("uses Turbo prune for the complete workspace dependency closure", () => {
		expect(dockerfile).toContain(
			"RUN ./node_modules/.bin/turbo prune notice-classifier --docker --out-dir=/repo/out",
		);
		expect(dockerfile).toContain("COPY --from=pruner /repo/out/json/ ./");
		expect(dockerfile).toContain("COPY --from=pruner /repo/out/full/ ./");
		expect(dockerfile).toContain(
			"pnpm install --ignore-scripts --frozen-lockfile --filter notice-classifier...",
		);
		expect(dockerfile).toContain(
			"pnpm install --ignore-scripts --prod --frozen-lockfile --filter notice-classifier...",
		);
		expect(dockerfile).toContain("RUN pnpm --filter notice-classifier build");
		expect(dockerfile).not.toMatch(/COPY packages\/(?:ingestion-contracts|notice-database)\//u);
	});
});
