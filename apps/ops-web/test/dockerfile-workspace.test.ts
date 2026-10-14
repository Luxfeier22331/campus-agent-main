import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");
const dockerfile = readFileSync(join(repoRoot, "apps/ops-web/Dockerfile"), "utf8");
const dockerignore = readFileSync(join(repoRoot, ".dockerignore"), "utf8");
const dockerBake = readFileSync(join(repoRoot, "docker-bake.hcl"), "utf8");

const workspaceSourceInputs = [
	"packages/contracts",
	"packages/domains/dining",
	"packages/domains/notices",
	"packages/ingestion-contracts",
	"packages/internal-portal-client",
	"packages/ui",
] as const;

describe("ops-web Dockerfile workspace inputs", () => {
	it("prunes the workspace closure before installing package dependencies", () => {
		const rootManifest = "COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./";
		const prunerInstall =
			"pnpm install --ignore-scripts --frozen-lockfile --filter campus-agent-web-workspace";
		const prune = "RUN ./node_modules/.bin/turbo prune ops-web --docker --out-dir=/repo/out";
		const buildManifest = "COPY --from=pruner /repo/out/json/ ./";
		const buildInstall = "pnpm install --ignore-scripts --frozen-lockfile --filter ops-web...";
		const fullSource = "COPY --from=pruner /repo/out/full/ ./";
		const build = "pnpm --filter ops-web build";

		expect(dockerfile).toContain(rootManifest);
		expect(dockerfile.indexOf(rootManifest)).toBeLessThan(dockerfile.indexOf(prunerInstall));
		expect(dockerfile).toContain(prune);
		expect(dockerfile.indexOf(prunerInstall)).toBeLessThan(dockerfile.indexOf(prune));
		expect(dockerfile).toContain(buildManifest);
		expect(dockerfile.indexOf(buildManifest)).toBeLessThan(dockerfile.indexOf(buildInstall));
		expect(dockerfile).toContain(fullSource);
		expect(dockerfile.indexOf(fullSource)).toBeLessThan(dockerfile.indexOf(build));
	});

	it("takes workspace sources from the pruned output", () => {
		const build = "pnpm --filter ops-web build";
		const fullSource = "COPY --from=pruner /repo/out/full/ ./";

		for (const workspacePath of workspaceSourceInputs) {
			const source = `COPY ${workspacePath} ./${workspacePath}`;

			expect(dockerfile).not.toContain(source);
		}
		expect(dockerfile.indexOf(fullSource)).toBeLessThan(dockerfile.indexOf(build));
	});

	it("passes the public tldraw key to the build stage only", () => {
		const buildStart = dockerfile.indexOf(" AS build");
		const runtimeStart = dockerfile.indexOf(" AS runtime");
		const buildStage = dockerfile.slice(buildStart, runtimeStart);
		const runtimeStage = dockerfile.slice(runtimeStart);

		expect(buildStage).toContain("ARG VITE_TLDRAW_LICENSE_KEY");
		expect(buildStage).toContain("ENV VITE_TLDRAW_LICENSE_KEY=$VITE_TLDRAW_LICENSE_KEY");
		expect(runtimeStage).not.toContain("VITE_TLDRAW_LICENSE_KEY");
		expect(dockerBake).toMatch(
			/target "ops-web"[\s\S]*?args = \{[\s\S]*?VITE_TLDRAW_LICENSE_KEY = VITE_TLDRAW_LICENSE_KEY/u,
		);
	});

	it("does not copy integration-only application sources into the build stage", () => {
		for (const workspacePath of ["apps/app-api", "apps/campus-web"]) {
			expect(dockerfile).not.toContain(`COPY ${workspacePath} ./${workspacePath}`);
		}
	});

	it("allows only the Campus Web manifest into the Docker build context", () => {
		const patterns = dockerignore.split("\n");
		expect(patterns).toContain("!apps/campus-web/");
		expect(patterns).toContain("apps/campus-web/**");
		expect(patterns).toContain("!apps/campus-web/package.json");
		expect(patterns).not.toContain("!apps/campus-web/**");
	});

	it("keeps the non-ingestion config allowlist explicit", () => {
		const patterns = dockerignore.split("\n");
		expect(patterns).toContain("configs/runtime/**");
		expect(patterns).toContain("!configs/runtime/tools.v8.json");
		expect(patterns).toContain("!configs/runtime/tool-function-schemas.v4.json");
		expect(patterns).toContain("!configs/runtime/latency-budgets.v1.json");
		expect(patterns).toContain("configs/sources/**");
		expect(patterns).toContain("!configs/sources/internal-portal.json");
		expect(patterns).not.toContain("!configs/runtime/provider-pricing.v1.json");
		expect(patterns).not.toContain("!configs/runtime/workflow-artifacts.v3.json");
		expect(patterns).not.toContain(
			"!configs/sources/official_web/muc_public/target-inventory.json",
		);
	});
});
