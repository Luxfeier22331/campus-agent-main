import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");
const dockerfile = readFileSync(join(repoRoot, "apps/ops-web/Dockerfile"), "utf8");

describe("ops-web Dockerfile workspace inputs", () => {
	it("includes the notices workspace manifest before dependency installation", () => {
		const manifest =
			"COPY packages/domains/notices/package.json ./packages/domains/notices/package.json";
		const install = "pnpm install --frozen-lockfile --filter 'ops-web...'";

		expect(dockerfile).toContain(manifest);
		expect(dockerfile.indexOf(manifest)).toBeLessThan(dockerfile.indexOf(install));
	});

	it("copies the notices workspace source into the build stage", () => {
		const source = "COPY packages/domains/notices ./packages/domains/notices";
		const build = "pnpm --filter ops-web build";

		expect(dockerfile).toContain(source);
		expect(dockerfile.indexOf(source)).toBeLessThan(dockerfile.indexOf(build));
	});
});
