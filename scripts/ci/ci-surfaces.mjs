import { matchesGlob } from "node:path";

const SHARED_NODE_RELEASE_INPUTS = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];

export const IMAGE_DEFINITIONS = Object.freeze({
	"agent-runtime": {
		checkTarget: "build",
		dockerfile: "apps/agent-runtime/Dockerfile",
		packages: ["agent-runtime"],
		inputs: [
			"apps/agent-runtime/package.json",
			"apps/agent-runtime/src/**",
			"apps/agent-runtime/tsconfig.json",
			"configs/runtime/tool-function-schemas.v2.json",
			"configs/runtime/tools.v5.json",
			"configs/runtime/workflow-artifacts.v2.json",
		],
	},
	"app-api-schema": {
		checkTarget: "dependencies",
		dockerfile: "jobs/app-api-schema/Dockerfile",
		packages: ["app-api-schema"],
		inputs: [
			"apps/app-api/db/shared-product-schema/**",
			"apps/app-api/drizzle/**",
			"apps/app-api/ops/db/**",
			"apps/app-api/package.json",
			"apps/app-api/src/script-support/shared-db/**",
			"jobs/app-api-schema/package.json",
		],
	},
	"docs-publish": {
		checkTarget: "dependencies",
		dockerfile: "jobs/docs-publish/Dockerfile",
		packages: ["docs-publish"],
		inputs: [
			"jobs/docs-publish/package.json",
			"jobs/docs-publish/src/**",
			"packages/contracts/schemas/**",
		],
	},
	"execution-control": {
		checkTarget: "build",
		dockerfile: "apps/execution-control/Dockerfile",
		packages: [],
		inputs: [
			"apps/execution-control/**/*.go",
			"apps/execution-control/go.mod",
			"apps/execution-control/go.sum",
			"configs/ingestion/**",
			"configs/runtime/execution-control/**",
			"configs/runtime/query-serving-targets.v1.json",
			"configs/runtime/tool-function-schemas.v2.json",
			"configs/runtime/tools.v5.json",
			"configs/runtime/workflow-artifacts.v2.json",
			"packages/contracts/fixtures/tool_execution_contract/**",
		],
		excludedInputs: ["apps/execution-control/**/*_test.go"],
	},
	"ingestion-control": {
		checkTarget: "check",
		dockerfile: "apps/ingestion-control/Dockerfile",
		packages: [
			"@campus-agent/telemetry-node",
			"ingest-core",
			"ingestion-contracts",
			"ingestion-control",
		],
		inputs: [
			"apps/ingestion-control/migrations/**",
			"apps/ingestion-control/package.json",
			"apps/ingestion-control/src/**",
			"configs/ingestion/**",
			"packages/ingest-core/package.json",
			"packages/ingest-core/src/**",
			"packages/ingestion-contracts/package.json",
			"packages/ingestion-contracts/schemas/**",
			"packages/ingestion-contracts/src/**",
			"packages/telemetry-node/package.json",
			"packages/telemetry-node/src/**",
		],
		target: "api",
	},
	"ingestion-control-worker": {
		checkTarget: "check",
		dockerfile: "apps/ingestion-control/Dockerfile",
		packages: [
			"@campus-agent/telemetry-node",
			"ingest-core",
			"ingestion-contracts",
			"ingestion-control",
		],
		inputs: [
			"apps/ingestion-control/migrations/**",
			"apps/ingestion-control/package.json",
			"apps/ingestion-control/src/**",
			"Cargo.lock",
			"Cargo.toml",
			"configs/ingestion/**",
			"packages/ingest-core/package.json",
			"packages/ingest-core/src/**",
			"packages/ingestion-contracts/package.json",
			"packages/ingestion-contracts/schemas/**",
			"packages/ingestion-contracts/src/**",
			"packages/ingestion-kernels-rs/Cargo.toml",
			"packages/ingestion-kernels-rs/src/**",
			"packages/telemetry-node/package.json",
			"packages/telemetry-node/src/**",
		],
		target: "worker",
	},
	"ops-web": {
		checkTarget: "build",
		dockerfile: "apps/ops-web/Dockerfile",
		packages: ["ops-web"],
		inputs: [
			"apps/ops-web/browser.config.ts",
			"apps/ops-web/index.html",
			"apps/ops-web/package.json",
			"apps/ops-web/public/**",
			"apps/ops-web/src/**",
			"apps/ops-web/tsconfig.json",
			"apps/ops-web/vite.config.ts",
			"packages/domains/dining/package.json",
			"packages/domains/dining/src/**",
		],
	},
	"source-collector": {
		checkTarget: "check",
		dockerfile: "apps/source-collector/Dockerfile",
		packages: [
			"@campus-agent/telemetry-node",
			"ingest-core",
			"ingestion-contracts",
			"source-collector",
		],
		inputs: [
			"apps/source-collector/package.json",
			"apps/source-collector/src/**",
			"configs/ingestion/**",
			"configs/sources/**",
			"packages/ingest-core/package.json",
			"packages/ingest-core/src/**",
			"packages/ingestion-contracts/package.json",
			"packages/ingestion-contracts/schemas/**",
			"packages/ingestion-contracts/src/**",
			"packages/telemetry-node/package.json",
			"packages/telemetry-node/src/**",
		],
		target: "runtime",
	},
	"transport-publisher": {
		checkTarget: "build",
		dockerfile: "jobs/transport-publisher/Dockerfile",
		packages: ["transport-publisher"],
		inputs: [
			"apps/app-api/db/shared-product-schema/campus_services.sql",
			"jobs/transport-publisher/package.json",
			"jobs/transport-publisher/src/**",
			"packages/contracts/schemas/transport-schedule-status.v1.schema.json",
		],
	},
});

const SHARED_WORKER_DEPLOY_INPUTS = [
	"scripts/deploy/run-wrangler-command.ts",
	"scripts/deploy/staging-release.ts",
	"scripts/deploy/worker-observability-config.ts",
	"scripts/deploy/worker-version.ts",
];

export const WORKER_DEFINITIONS = Object.freeze({
	"app-api": {
		packages: ["app-api", "@campus-agent/dining"],
		inputs: [
			"apps/app-api/package.json",
			"apps/app-api/scripts/staging-upload-config.ts",
			"apps/app-api/scripts/upload-staging-version.ts",
			"apps/app-api/src/**",
			"apps/app-api/tsconfig.json",
			"apps/app-api/wrangler*.toml",
			"configs/runtime/latency-budgets.v1.json",
			"packages/domains/dining/package.json",
			"packages/domains/dining/src/**",
			...SHARED_WORKER_DEPLOY_INPUTS,
		],
	},
	"campus-web": {
		packages: ["campus-web", "@campus-agent/dining"],
		inputs: [
			"apps/campus-web/index.html",
			"apps/campus-web/package.json",
			"apps/campus-web/public/**",
			"apps/campus-web/scripts/build-published-reader-docs.ts",
			"apps/campus-web/scripts/build-release.ts",
			"apps/campus-web/scripts/check-client-bundle-budget.ts",
			"apps/campus-web/scripts/upload-staging-version.ts",
			"apps/campus-web/src/**",
			"apps/campus-web/theme/**",
			"apps/campus-web/tsconfig.json",
			"apps/campus-web/vite.config.ts",
			"apps/campus-web/wrangler*.toml",
			"configs/branding/web-public/**",
			"packages/domains/dining/package.json",
			"packages/domains/dining/src/**",
			"scripts/deploy/run-worker-staging-build.ts",
			"scripts/deploy/verify-worker-deploy-config.ts",
			...SHARED_WORKER_DEPLOY_INPUTS,
		],
	},
});

export const ALL_IMAGES = Object.freeze(Object.keys(IMAGE_DEFINITIONS).sort());
export const ALL_WORKERS = Object.freeze(Object.keys(WORKER_DEFINITIONS).sort());

function matchesDefinition(file, definition) {
	return (
		(definition.inputs ?? []).some((pattern) => matchesGlob(file, pattern)) &&
		!(definition.excludedInputs ?? []).some((pattern) => matchesGlob(file, pattern))
	);
}

function surfacesForFiles(files, definitions) {
	const selected = new Set();
	for (const file of files) {
		for (const [name, definition] of Object.entries(definitions)) {
			if (file === definition.dockerfile || matchesDefinition(file, definition)) {
				selected.add(name);
			}
		}
	}
	return selected;
}

function surfacesForPackages(packageNames, definitions) {
	const selected = new Set();
	for (const [name, definition] of Object.entries(definitions)) {
		if (definition.packages.some((packageName) => packageNames.has(packageName))) {
			selected.add(name);
		}
	}
	return selected;
}

export function imagesForFiles(files) {
	return surfacesForFiles(files, IMAGE_DEFINITIONS);
}

export function imagesForPackages(packageNames) {
	return surfacesForPackages(packageNames, IMAGE_DEFINITIONS);
}

export function workersForFiles(files) {
	return surfacesForFiles(files, WORKER_DEFINITIONS);
}

export function workersForPackages(packageNames) {
	return surfacesForPackages(packageNames, WORKER_DEFINITIONS);
}

export function imageForDockerfile(file) {
	return Object.entries(IMAGE_DEFINITIONS)
		.filter(([, definition]) => definition.dockerfile === file)
		.map(([image]) => image);
}

export function isSharedNodeReleaseInput(file) {
	return SHARED_NODE_RELEASE_INPUTS.includes(file);
}
