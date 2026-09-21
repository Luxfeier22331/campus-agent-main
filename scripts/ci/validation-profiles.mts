export const NODE_TEST_GROUPS = [
	"test:node:fast",
	"test:node:isolated",
	"test:dom:fast",
	"test:dom:isolated",
] as const;
export const PR_NODE_TASKS = ["test", "test:worker", ...NODE_TEST_GROUPS] as const;
export const NODE_TASKS = ["typecheck", ...PR_NODE_TASKS] as const;

// These packages keep `test` as a human entry point; evidence executes its leaves once.
export function isEvidenceTask(item: { package: string; task: string }): boolean {
	if (item.task === "test" && ["app-api", "campus-web", "ops-web"].includes(item.package)) {
		return false;
	}
	return !(item.package === "status-web" && item.task === "build");
}
export const NATIVE_TASKS = [
	"native:format",
	"native:lint",
	"native:typecheck",
	"native:test",
] as const;
export const BUILD_TASKS = ["build", "build:worker"] as const;
export const EVAL_TASKS = ["test:eval"] as const;
export const DATABASE_TASKS = [
	"test:migration-integration",
	"test:database-integration",
	"test:shared-db-integration",
] as const;
export const CONTRACT_COMMAND = ["pnpm", "--dir", "packages/contracts", "check"] as const;
export const ACTION_COMMANDS = [
	["actionlint"],
	["zizmor", "--min-severity=medium", ".github"],
] as const;

export type ValidationLane = "manual" | "pull-request";

export type ValidationCommand = readonly [command: string, ...args: string[]];

type ValidationExecutor =
	| { kind: "affected-node" }
	| { kind: "affected-native" }
	| { kind: "native" }
	| { kind: "affected-images" }
	| { commands: readonly ValidationCommand[]; kind: "commands" };

interface ValidationProfileDefinition {
	shell: string;
	installPackages: readonly string[];
	executor: ValidationExecutor;
	lane: ValidationLane;
	requiresDocker: boolean;
	requiresUv: boolean;
}

function turboCommand(packageName: string, ...tasks: string[]): ValidationCommand {
	return [
		"node",
		"--experimental-strip-types",
		"scripts/ci/turbo.mts",
		...tasks,
		`--filter=${packageName}`,
		"--summarize",
	];
}

function serializedTurboCommand(packageName: string, task: string): ValidationCommand {
	return [
		"node",
		"--experimental-strip-types",
		"scripts/ci/turbo.mts",
		task,
		`--filter=${packageName}`,
		"--concurrency=1",
		"--summarize",
	];
}

export const VALIDATION_PROFILE_REGISTRY = {
	"affected-node": {
		shell: "ci-core",
		installPackages: [],
		executor: { kind: "affected-node" },
		lane: "pull-request",
		requiresDocker: false,
		requiresUv: false,
	},
	"container-build": {
		shell: "ci-release",
		installPackages: [],
		executor: {
			commands: [["docker", "buildx", "bake", "--file", "docker-bake.hcl", "--print"]],
			kind: "commands",
		},
		lane: "pull-request",
		requiresDocker: true,
		requiresUv: false,
	},
	"image-build": {
		shell: "ci-release",
		installPackages: [],
		executor: { kind: "affected-images" },
		lane: "pull-request",
		requiresDocker: true,
		requiresUv: false,
	},
	go: {
		shell: "ci-go",
		installPackages: [],
		executor: { kind: "native" },
		lane: "manual",
		requiresDocker: false,
		requiresUv: false,
	},
	"affected-native": {
		shell: "ci-go",
		installPackages: [],
		executor: { kind: "affected-native" },
		lane: "pull-request",
		requiresDocker: false,
		requiresUv: false,
	},
	ragas: {
		shell: "ci-light",
		installPackages: ["eval-langfuse...", "ragas-runner"],
		executor: {
			commands: [
				turboCommand("eval-langfuse", "typecheck", "test"),
				serializedTurboCommand("ragas-runner", EVAL_TASKS[0]),
			],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: false,
		requiresUv: true,
	},
	"schema-migration": {
		shell: "ci-release",
		installPackages: ["campus-agent-schema..."],
		executor: {
			commands: [turboCommand("campus-agent-schema", "test:migration-integration")],
			kind: "commands",
		},
		lane: "pull-request",
		requiresDocker: true,
		requiresUv: false,
	},
	"app-api-product-db": {
		shell: "ci-release",
		installPackages: ["app-api...", "campus-agent-schema..."],
		executor: {
			commands: [turboCommand("app-api", "test:shared-db-integration")],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: true,
		requiresUv: false,
	},
	"execution-control-postgres": {
		shell: "ci-full",
		installPackages: ["campus-agent-schema..."],
		executor: {
			commands: [turboCommand("execution-control", "test:database-integration")],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: true,
		requiresUv: false,
	},
	"execution-control-temporal": {
		shell: "ci-go",
		installPackages: ["agent-runtime..."],
		executor: {
			commands: [["pnpm", "--dir", "apps/execution-control", "test:temporal-integration"]],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: false,
		requiresUv: false,
	},
	"execution-control-stream": {
		shell: "ci-go",
		installPackages: [],
		executor: {
			commands: [["pnpm", "--dir", "apps/execution-control", "test:stream-integration"]],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: false,
		requiresUv: false,
	},
	"execution-control-replay": {
		shell: "ci-go",
		installPackages: [],
		executor: {
			commands: [["pnpm", "--dir", "apps/execution-control", "test:temporal-replay"]],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: false,
		requiresUv: false,
	},
	"model-config-postgres": {
		shell: "ci-full",
		installPackages: ["campus-agent-schema..."],
		executor: {
			commands: [turboCommand("model-config", "test:database-integration")],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: true,
		requiresUv: false,
	},
	"ops-web-postgres": {
		shell: "ci-release",
		installPackages: ["ops-web...", "campus-agent-schema..."],
		executor: {
			commands: [turboCommand("ops-web", "test:database-integration")],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: true,
		requiresUv: false,
	},
	infra: {
		shell: "ci-full",
		installPackages: [],
		executor: { commands: [["scripts/infra/validate.sh"]], kind: "commands" },
		lane: "manual",
		requiresDocker: false,
		requiresUv: false,
	},
	otel: {
		shell: "ci-release",
		installPackages: [],
		executor: { commands: [["scripts/otel/validate-config.sh"]], kind: "commands" },
		lane: "manual",
		requiresDocker: true,
		requiresUv: false,
	},
} as const satisfies Record<string, ValidationProfileDefinition>;

export type ValidationProfile = keyof typeof VALIDATION_PROFILE_REGISTRY;

export const VALIDATION_PROFILES = Object.keys(VALIDATION_PROFILE_REGISTRY) as ValidationProfile[];

export const MANUAL_VALIDATION_PROFILES = VALIDATION_PROFILES.filter(
	(profile) => VALIDATION_PROFILE_REGISTRY[profile].lane === "manual",
);

export function isValidationProfile(value: string): value is ValidationProfile {
	return Object.hasOwn(VALIDATION_PROFILE_REGISTRY, value);
}

export function validationProfileMetadata(profile: string): {
	lane: ValidationLane;
	name: ValidationProfile;
	shell: string;
	installPackages: readonly string[];
	requiresDocker: boolean;
	requiresUv: boolean;
} {
	if (!isValidationProfile(profile)) {
		throw new Error(`Unsupported validation profile: ${profile}`);
	}
	const definition = VALIDATION_PROFILE_REGISTRY[profile];
	return {
		lane: definition.lane,
		name: profile,
		shell: definition.shell,
		installPackages: definition.installPackages,
		requiresDocker: definition.requiresDocker,
		requiresUv: definition.requiresUv,
	};
}
