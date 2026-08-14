import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");
const dockerfile = readFileSync(
	join(repoRoot, "jobs/notice-publisher/Dockerfile"),
	"utf8",
);
const packageJson = JSON.parse(
	readFileSync(join(repoRoot, "jobs/notice-publisher/package.json"), "utf8"),
) as {
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
	scripts: Record<string, string>;
};

describe("notice-publisher production artifact", () => {
	it("bundles the CLI during the image build", () => {
		expect(packageJson.scripts.build).toContain("--outfile=dist/cli.js");
		expect(packageJson.devDependencies.esbuild).toBe("0.28.2");
		expect(dockerfile).toContain("pnpm --filter notice-publisher build");
		expect(dockerfile).toContain("node --check jobs/notice-publisher/dist/cli.js");
	});

	it("runs JavaScript and retains the migration files", () => {
		expect(packageJson.dependencies.tsx).toBeUndefined();
		expect(dockerfile).toContain(
			"COPY --from=build --chown=node:node /app/jobs/notice-publisher/migrations ./jobs/notice-publisher/migrations",
		);
		expect(dockerfile).toContain(
			'ENTRYPOINT ["node", "jobs/notice-publisher/dist/cli.js"]',
		);
		expect(dockerfile).not.toMatch(/ENTRYPOINT .*tsx|ENTRYPOINT .*src\/cli\.ts/u);
	});
});
