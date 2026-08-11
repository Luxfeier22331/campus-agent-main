import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
type JsonObject = Record<string, unknown>;

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

test("Turbo affected selection uses task inputs and no phantom CI tasks", () => {
	const turbo = readJson("turbo.json");
	const tasks = turbo.tasks as JsonObject;
	const futureFlags = turbo.futureFlags as JsonObject;
	assert.equal(futureFlags.affectedUsingTaskInputs, true);
	assert.equal(
		Object.keys(tasks).some((task) => task.startsWith("//#ci:")),
		false,
	);
	assert.equal(tasks["app-api-schema#build"], undefined);
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
		"test:integration",
		"test:browser",
		"test:e2e:full",
		"test:e2e:smoke",
		"deploy",
	]) {
		const taskConfig = tasks[task] as JsonObject | undefined;
		assert.equal(taskConfig?.cache, false, `${task} must remain uncached`);
	}
});

test("expensive package tasks declare boundary-specific affected inputs", () => {
	const owners: [string, string[]][] = [
		["apps/app-api/turbo.json", ["test:migration-integration", "test:shared-db-integration"]],
		["apps/campus-web/turbo.json", ["test:e2e:full", "test:e2e:smoke"]],
		["apps/execution-control/turbo.json", ["test:database-integration"]],
		["apps/ingestion-control/turbo.json", ["test:database-integration"]],
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

test("Campus Web formal build remains uncached because it reads mutable object storage", () => {
	const campusTurbo = readJson("apps/campus-web/turbo.json");
	const tasks = campusTurbo.tasks as JsonObject;
	const build = tasks.build as JsonObject;
	assert.equal(build.cache, false);
});
