import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");
const dockerfile = readFileSync(join(repoRoot, "jobs/notice-classifier/Dockerfile"), "utf8");

describe("notice-classifier Dockerfile workspace inputs", () => {
	it("includes ingestion-contracts in dependency installation and build inputs", () => {
		const manifest =
			"COPY packages/ingestion-contracts/package.json ./packages/ingestion-contracts/package.json";
		const source =
			"COPY packages/ingestion-contracts/src ./packages/ingestion-contracts/src";
		const install = "pnpm install --frozen-lockfile --filter notice-classifier...";
		const productionInstall =
			"pnpm install --prod --frozen-lockfile --filter notice-classifier...";
		const build = "pnpm --filter notice-classifier build";
		const manifestCopies = dockerfile.split(manifest).length - 1;

		expect(manifestCopies).toBe(2);
		expect(dockerfile.indexOf(manifest)).toBeLessThan(dockerfile.indexOf(install));
		expect(dockerfile.lastIndexOf(manifest)).toBeLessThan(
			dockerfile.indexOf(productionInstall),
		);
		expect(dockerfile).toContain(source);
		expect(dockerfile.indexOf(source)).toBeLessThan(dockerfile.indexOf(build));
	});
});
