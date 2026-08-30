import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");
const dockerfile = readFileSync(join(repoRoot, "apps/ops-web/Dockerfile"), "utf8");
const dockerignore = readFileSync(join(repoRoot, ".dockerignore"), "utf8");

type DependencyField =
	| "dependencies"
	| "devDependencies"
	| "optionalDependencies"
	| "peerDependencies";

interface PackageManifest {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	name?: string;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

interface WorkspaceManifest {
	manifest: PackageManifest;
	workspacePath: string;
}

const dependencyFields: DependencyField[] = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
];

function readManifest(relativePath: string): PackageManifest {
	return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as PackageManifest;
}

const workspaceManifests = new Map<string, WorkspaceManifest>();
for (const manifestPath of globSync(
	[
		"apps/*/package.json",
		"jobs/*/package.json",
		"packages/*/package.json",
		"packages/domains/*/package.json",
	],
	{ cwd: repoRoot },
).sort()) {
	const manifest = readManifest(manifestPath);
	if (!manifest.name) {
		throw new Error(`Workspace manifest has no package name: ${manifestPath}`);
	}
	if (workspaceManifests.has(manifest.name)) {
		throw new Error(`Duplicate workspace package name: ${manifest.name}`);
	}
	workspaceManifests.set(manifest.name, {
		manifest,
		workspacePath: manifestPath.slice(0, -"/package.json".length),
	});
}

function workspaceDependencies(manifest: PackageManifest): string[] {
	const dependencies: string[] = [];
	for (const field of dependencyFields) {
		for (const [name, version] of Object.entries(manifest[field] ?? {})) {
			if (version.startsWith("workspace:")) {
				dependencies.push(name);
			}
		}
	}
	return dependencies;
}

function workspaceManifestClosure(): string[] {
	const rootManifest = readManifest("package.json");
	const opsWeb = workspaceManifests.get("ops-web");
	if (!opsWeb) {
		throw new Error("Ops Web workspace manifest is missing");
	}

	const closure = new Set([opsWeb.workspacePath]);
	const pending = [
		...workspaceDependencies(rootManifest),
		...workspaceDependencies(opsWeb.manifest),
	];
	for (const packageName of pending) {
		const workspace = workspaceManifests.get(packageName);
		if (!workspace) {
			throw new Error(`Workspace dependency has no manifest: ${packageName}`);
		}
		if (closure.has(workspace.workspacePath)) {
			continue;
		}
		closure.add(workspace.workspacePath);
		pending.push(...workspaceDependencies(workspace.manifest));
	}
	return [...closure].sort();
}

const workspaceSourceInputs = [
	"packages/contracts",
	"packages/domains/dining",
	"packages/domains/notices",
	"packages/ingestion-contracts",
	"packages/internal-portal-client",
	"packages/ui",
] as const;

describe("ops-web Dockerfile workspace inputs", () => {
	it("includes the recursive workspace manifest closure before dependency installation", () => {
		const install = "pnpm install --frozen-lockfile --filter 'ops-web...'";
		const rootManifest = "COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./";

		expect(dockerfile).toContain(rootManifest);
		expect(dockerfile.indexOf(rootManifest)).toBeLessThan(dockerfile.indexOf(install));
		for (const workspacePath of workspaceManifestClosure()) {
			const manifest = `COPY ${workspacePath}/package.json ./${workspacePath}/package.json`;

			expect(dockerfile).toContain(manifest);
			expect(dockerfile.indexOf(manifest)).toBeLessThan(dockerfile.indexOf(install));
		}
	});

	it("copies every build-owned workspace source before the package build", () => {
		const build = "pnpm --filter ops-web build";

		for (const workspacePath of workspaceSourceInputs) {
			const source = `COPY ${workspacePath} ./${workspacePath}`;

			expect(dockerfile).toContain(source);
			expect(dockerfile.indexOf(source)).toBeLessThan(dockerfile.indexOf(build));
		}
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
		expect(patterns).toContain("!configs/runtime/tools.v7.json");
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
