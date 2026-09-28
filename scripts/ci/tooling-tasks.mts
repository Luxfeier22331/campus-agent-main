export const TOOLING_GROUPS = [
	"ci",
	"deploy",
	"dev",
	"docs",
	"hooks",
	"notices",
	"release",
] as const;

// Only these groups inspect which paths are tracked. File contents belong to Turbo inputs.
export const TOOLING_TRACKED_PATHS = {
	ci: ["."],
	docs: ["docs", ".agents", "README.md", ".config/.markdownlint-cli2.jsonc", ".gitignore"],
	release: ["."],
} as const;

export const toolingTask = (group: string): string => `@campus-agent/tooling#test:${group}`;

export type ToolingGroup = (typeof TOOLING_GROUPS)[number];

export function toolingGroupsForFiles(files: readonly string[]): ToolingGroup[] {
	const selected = new Set<ToolingGroup>();
	for (const file of files) {
		if (!file.includes("/")) {
			selected.add("ci");
		}
		if (file === "package.json" || file === "pnpm-lock.yaml" || file === "pnpm-workspace.yaml") {
			selected.add("release");
		}
		if (file === ".github" || file.startsWith(".github/") || file.startsWith("scripts/ci/")) {
			selected.add("ci");
		}
		if (file === "deploy" || file.startsWith("deploy/") || file.startsWith("scripts/deploy/")) {
			selected.add("deploy");
		}
		if (file === "dev" || file.startsWith("dev/") || file.startsWith("scripts/dev/")) {
			selected.add("dev");
		}
		if (
			file === "docs" ||
			file.startsWith("docs/") ||
			file === ".agents" ||
			file.startsWith(".agents/") ||
			file === "README.md" ||
			file === ".config/.markdownlint-cli2.jsonc"
		) {
			selected.add("docs");
		}
		if (
			file === "hooks" ||
			file.startsWith("hooks/") ||
			file.startsWith("scripts/hooks/") ||
			file === ".config/.pre-commit-config.yaml"
		) {
			selected.add("hooks");
		}
		if (file === "notices" || file.startsWith("notices/") || file.startsWith("scripts/notices/")) {
			selected.add("notices");
		}
		if (
			file === "release" ||
			file.startsWith("release/") ||
			file.startsWith("scripts/release/") ||
			file === "docker-bake.hcl" ||
			file === ".dockerignore" ||
			(file.startsWith("apps/") && (file.endsWith("/Dockerfile") || file.includes("/wrangler")))
		) {
			selected.add("release");
		}
	}
	return TOOLING_GROUPS.filter((group) => selected.has(group));
}
