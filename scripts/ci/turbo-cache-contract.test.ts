import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
type JsonObject = Record<string, unknown>;

interface WorkspaceManifest {
	name: string;
	path: string;
	scripts: Record<string, unknown>;
}

function readJson(relativePath: string): JsonObject {
	return JSON.parse(readFileSync(path.join(ROOT, relativePath), "utf8")) as JsonObject;
}

function inputsFor(tasks: JsonObject, task: string): string[] {
	const taskConfig = tasks[task];
	assert(taskConfig !== null && typeof taskConfig === "object", `${task} must be an object`);
	const inputs = (taskConfig as JsonObject).inputs;
	assert(Array.isArray(inputs), `${task} must declare explicit inputs`);
	return inputs as string[];
}

function assertTaskInputs(config: string, taskNames: string[], requiredInputs: string[]): void {
	const tasks = readJson(config).tasks as JsonObject;
	for (const task of taskNames) {
		const inputs = inputsFor(tasks, task);
		for (const input of requiredInputs) {
			assert(inputs.includes(input), `${config} ${task} must include ${input}`);
		}
	}
}

function readTrackedWorkspaceManifests(): WorkspaceManifest[] {
	const paths = execFileSync("git", ["ls-files", "-z", ":(glob)**/package.json"], {
		cwd: ROOT,
		encoding: "utf8",
	})
		.split("\0")
		.filter(
			(relativePath) =>
				relativePath &&
				relativePath !== "package.json" &&
				existsSync(path.join(ROOT, relativePath)),
		);

	return paths.map((relativePath) => {
		const manifest = readJson(relativePath);
		if (typeof manifest.name !== "string") {
			throw new Error(`${relativePath} must declare a package name`);
		}
		const scripts = manifest.scripts;
		return {
			name: manifest.name,
			path: relativePath,
			scripts:
				scripts !== null && typeof scripts === "object" ? (scripts as Record<string, unknown>) : {},
		};
	});
}

test("Turbo affected selection uses task inputs and no phantom CI tasks", () => {
	const turbo = readJson("turbo.json");
	const tasks = turbo.tasks as JsonObject;
	const futureFlags = turbo.futureFlags as JsonObject;
	assert.equal(futureFlags.affectedUsingTaskInputs, true);
	assert.equal(
		Object.keys(tasks).some((task) => task.startsWith("//#ci:")),
		false,
	);
	assert.equal(tasks["execution-control#build"], undefined);

	for (const task of ["build", "typecheck", "test", "test:worker"]) {
		const inputs = inputsFor(tasks, task);
		assert(inputs.includes("$TURBO_DEFAULT$"), `${task} must include package defaults`);
	}
});

test("Turbo does not cache side-effecting or environment-coupled tasks", () => {
	const tasks = readJson("turbo.json").tasks as JsonObject;
	for (const task of [
		"test:migration-integration",
		"test:database-integration",
		"test:shared-db-integration",
		"test:browser",
		"test:e2e:full",
		"test:e2e:smoke",
	]) {
		const taskConfig = tasks[task] as JsonObject | undefined;
		assert.equal(taskConfig?.cache, false, `${task} must remain uncached`);
	}
});

test("every root Turbo task has a tracked workspace script owner", () => {
	const tasks = readJson("turbo.json").tasks as JsonObject;
	const manifests = readTrackedWorkspaceManifests();

	for (const taskName of Object.keys(tasks)) {
		const separator = taskName.indexOf("#");
		if (separator === -1) {
			assert(
				manifests.some((manifest) => typeof manifest.scripts[taskName] === "string"),
				`${taskName} must be provided by at least one tracked workspace package`,
			);
			continue;
		}

		const packageName = taskName.slice(0, separator);
		const scriptName = taskName.slice(separator + 1);
		const owner = manifests.find((manifest) => manifest.name === packageName);
		assert(owner, `${taskName} must reference a tracked workspace package`);
		assert.equal(
			typeof owner.scripts[scriptName],
			"string",
			`${taskName} must reference a script declared by ${owner.path}`,
		);
	}
});

test("expensive package tasks declare boundary-specific affected inputs", () => {
	const owners: [string, string[]][] = [
		["apps/app-api/turbo.json", ["test:shared-db-integration"]],
		["apps/campus-web/turbo.json", ["test:e2e:full", "test:e2e:smoke"]],
		["apps/execution-control/turbo.json", ["test:database-integration"]],
		["apps/model-config/turbo.json", ["test:database-integration"]],
		["apps/ops-web/turbo.json", ["test:browser", "test:database-integration"]],
		["apps/status-web/turbo.json", ["test:browser"]],
	];
	for (const [config, taskNames] of owners) {
		const tasks = readJson(config).tasks as JsonObject;
		for (const task of taskNames) {
			const inputs = inputsFor(tasks, task);
			assert(inputs.length > 0, `${config} ${task} must declare affected inputs`);
			assert(
				!inputs.includes("$TURBO_DEFAULT$"),
				`${config} ${task} must remain boundary-specific`,
			);
		}
	}
});

test("Ops Web database tasks track their schema source owners", () => {
	assertTaskInputs(
		"apps/ops-web/turbo.json",
		["test:database-integration"],
		["$TURBO_ROOT$/jobs/campus-agent-schema/**"],
	);
});

test("Campus Web formal build remains uncached because it reads mutable object storage", () => {
	const campusTurbo = readJson("apps/campus-web/turbo.json");
	const tasks = campusTurbo.tasks as JsonObject;
	const build = tasks.build as JsonObject;
	assert.equal(build.cache, false);
});

test("candidate build tasks declare their package-external artifact inputs", () => {
	assertTaskInputs(
		"apps/app-api/turbo.json",
		["build:worker"],
		[
			"$TURBO_ROOT$/configs/sources/internal-portal.json",
			"$TURBO_ROOT$/packages/contracts/package.json",
			"$TURBO_ROOT$/packages/contracts/src/**",
		],
	);
	assertTaskInputs(
		"apps/campus-web/turbo.json",
		["build", "build:test", "build:worker"],
		[
			"$TURBO_ROOT$/configs/sources/internal-portal.json",
			"$TURBO_ROOT$/packages/contracts/package.json",
			"$TURBO_ROOT$/packages/contracts/schemas/**",
			"$TURBO_ROOT$/packages/contracts/src/**",
		],
	);
	assertTaskInputs(
		"turbo.json",
		["ops-web#build"],
		[
			"$TURBO_ROOT$/configs/sources/internal-portal.json",
			"$TURBO_ROOT$/packages/contracts/package.json",
			"$TURBO_ROOT$/packages/contracts/src/**",
		],
	);
	assertTaskInputs(
		"jobs/internal-portal-collection/turbo.json",
		["build"],
		[
			"$TURBO_ROOT$/configs/sources/internal-portal.json",
			"$TURBO_ROOT$/packages/contracts/package.json",
			"$TURBO_ROOT$/packages/contracts/src/**",
			"$TURBO_ROOT$/packages/domains/notices/package.json",
			"$TURBO_ROOT$/packages/domains/notices/src/**",
			"$TURBO_ROOT$/packages/ingestion-contracts/package.json",
			"$TURBO_ROOT$/packages/ingestion-contracts/src/**",
			"$TURBO_ROOT$/packages/internal-portal-client/package.json",
			"$TURBO_ROOT$/packages/internal-portal-client/src/**",
		],
	);
	assertTaskInputs(
		"jobs/notice-publisher/turbo.json",
		["build"],
		[
			"$TURBO_ROOT$/configs/sources/internal-portal.json",
			"$TURBO_ROOT$/packages/contracts/package.json",
			"$TURBO_ROOT$/packages/contracts/src/**",
			"$TURBO_ROOT$/packages/domains/notices/package.json",
			"$TURBO_ROOT$/packages/domains/notices/src/**",
			"$TURBO_ROOT$/packages/ingestion-contracts/package.json",
			"$TURBO_ROOT$/packages/ingestion-contracts/schemas/**",
			"$TURBO_ROOT$/packages/ingestion-contracts/src/**",
		],
	);
	assertTaskInputs(
		"jobs/internal-portal-collection/turbo.json",
		["test", "typecheck"],
		["$TURBO_ROOT$/configs/sources/internal-portal.json"],
	);
});

test("tasks compiling the internal portal descriptor declare it as an affected input", () => {
	const descriptor = "$TURBO_ROOT$/configs/sources/internal-portal.json";
	assertTaskInputs("apps/app-api/turbo.json", ["test", "test:worker", "typecheck"], [descriptor]);
	assertTaskInputs(
		"apps/campus-web/turbo.json",
		["test", "test:e2e:smoke", "test:worker", "typecheck"],
		[descriptor],
	);
	assertTaskInputs("apps/ops-web/turbo.json", ["test:browser"], [descriptor]);
	assertTaskInputs("turbo.json", ["ops-web#test", "ops-web#typecheck"], [descriptor]);
	assertTaskInputs(
		"jobs/notice-publisher/turbo.json",
		["build", "test", "typecheck"],
		[descriptor],
	);
});
