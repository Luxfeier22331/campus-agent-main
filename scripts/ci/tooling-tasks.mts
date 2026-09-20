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
	docs: ["docs", ".agents", "README.md", ".markdownlint-cli2.jsonc", ".gitignore"],
	release: ["."],
} as const;

export const toolingTask = (group: string): string => `@campus-agent/tooling#test:${group}`;
