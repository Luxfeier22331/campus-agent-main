export type ValidationLane = "manual" | "pull-request";

type ValidationCommand = readonly [command: string, ...args: string[]];

type ValidationExecutor =
	| { kind: "affected-node" }
	| { commands: readonly ValidationCommand[]; kind: "commands" };

interface ValidationProfileDefinition {
	executor: ValidationExecutor;
	lane: ValidationLane;
	requiresDocker: boolean;
	requiresUv: boolean;
}

function turboCommand(packageName: string, ...tasks: string[]): ValidationCommand {
	return ["pnpm", "exec", "turbo", "run", ...tasks, `--filter=${packageName}`, "--summarize"];
}

function serializedTurboCommand(packageName: string, task: string): ValidationCommand {
	return [
		"pnpm",
		"exec",
		"turbo",
		"run",
		task,
		`--filter=${packageName}`,
		"--concurrency=1",
		"--summarize",
	];
}

function nativeCommands(packageName: string): ValidationCommand[] {
	return [
		serializedTurboCommand(packageName, "native:format"),
		serializedTurboCommand(packageName, "native:lint"),
		serializedTurboCommand(packageName, "native:typecheck"),
		serializedTurboCommand(packageName, "native:test"),
	];
}

export const VALIDATION_PROFILE_REGISTRY = {
	"affected-node": {
		executor: { kind: "affected-node" },
		lane: "pull-request",
		requiresDocker: false,
		requiresUv: false,
	},
	go: {
		executor: {
			commands: [...nativeCommands("execution-control"), ...nativeCommands("model-config")],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: false,
		requiresUv: false,
	},
	ragas: {
		executor: {
			commands: [
				turboCommand("eval-langfuse", "typecheck", "test"),
				serializedTurboCommand("ragas-runner", "test:eval"),
			],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: false,
		requiresUv: true,
	},
	"app-api-migration": {
		executor: {
			commands: [turboCommand("app-api", "test:migration-integration")],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: true,
		requiresUv: false,
	},
	"app-api-product-db": {
		executor: {
			commands: [turboCommand("app-api", "test:shared-db-integration")],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: true,
		requiresUv: false,
	},
	"execution-control-postgres": {
		executor: {
			commands: [turboCommand("execution-control", "test:database-integration")],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: true,
		requiresUv: false,
	},
	"model-config-postgres": {
		executor: {
			commands: [turboCommand("model-config", "test:database-integration")],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: true,
		requiresUv: false,
	},
	"ops-web-postgres": {
		executor: {
			commands: [turboCommand("ops-web", "test:database-integration")],
			kind: "commands",
		},
		lane: "manual",
		requiresDocker: true,
		requiresUv: false,
	},
	infra: {
		executor: { commands: [["scripts/infra/validate.sh"]], kind: "commands" },
		lane: "manual",
		requiresDocker: false,
		requiresUv: false,
	},
	otel: {
		executor: { commands: [["scripts/otel/validate-config.sh"]], kind: "commands" },
		lane: "manual",
		requiresDocker: true,
		requiresUv: false,
	},
	toolchain: {
		executor: {
			commands: [["docker", "buildx", "bake", "--file", "docker-bake.hcl", "--print"]],
			kind: "commands",
		},
		lane: "pull-request",
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
		requiresDocker: definition.requiresDocker,
		requiresUv: definition.requiresUv,
	};
}
