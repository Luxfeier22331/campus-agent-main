import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { type CommandResult, type CommandRunner, planCandidates } from "./candidates.mts";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

function result(overrides: Partial<CommandResult> = {}): CommandResult {
	return { status: 0, stderr: "", stdout: "", ...overrides };
}

function changed(...files: string[]): string {
	return `${files.flatMap((file) => ["M", file]).join("\0")}\0`;
}

async function fixture(t: test.TestContext): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "candidate-plan-"));
	t.after(() => rm(root, { force: true, recursive: true }));
	await writeFile(
		path.join(root, "selection.json"),
		`${JSON.stringify({ repository: "MUC-WIKI/campus-agent", sourceSha: BASE })}\n`,
	);
	await writeFile(
		path.join(root, "worker-versions.json"),
		`${JSON.stringify({
			schemaVersion: 2,
			workers: {
				"app-api-staging": { sourceSha: BASE, versionId: "app-api-version" },
				"campus-web-staging": { sourceSha: BASE, versionId: "campus-web-version" },
			},
		})}\n`,
	);
	return root;
}

function options(root: string) {
	return {
		head: HEAD,
		refreshCampusWebDocs: false,
		repositoryRoot: root,
		selectionFile: path.join(root, "selection.json"),
		validateOnly: false,
		workerSelectionFile: path.join(root, "worker-versions.json"),
	};
}

test("maps Turbo affected package tasks to release candidates", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (command, args, commandOptions) => {
		assert.equal(commandOptions.env.TURBO_SCM_BASE, BASE);
		assert.equal(commandOptions.env.TURBO_SCM_HEAD, HEAD);
		if (command === "pnpm") {
			return result({
				stdout: JSON.stringify({
					tasks: [
						{
							command: "tsc --project tsconfig.build.json",
							package: "agent-runtime",
							task: "build",
						},
						{ command: "vite build", package: "app-api", task: "build:worker" },
						{ command: "vite build", package: "campus-web", task: "build:worker" },
						{ command: "tsc", package: "ingestion-control", task: "build" },
						{ command: "tsc", package: "source-collector", task: "build" },
					],
				}),
			});
		}
		if (args[0] === "diff") {
			return result({
				stdout: changed("infra/k8s/execution-runtime/base/runtime/deployment.yaml"),
			});
		}
		return result();
	};
	assert.deepEqual(await planCandidates(options(root), runner), {
		base: BASE,
		head: HEAD,
		images: ["agent-runtime"],
		kubernetes: true,
		validateOnly: false,
		workers: ["app-api-staging", "campus-web-staging"],
	});
});

test("task graph configuration does not publish business artifacts", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (command, args) => {
		if (args[0] === "diff") {
			return result({
				stdout: changed(
					"package.json",
					"turbo.json",
					"apps/execution-control/turbo.json",
					"infra/k8s/data-object-store/base/bootstrap.yaml",
				),
			});
		}
		if (args[0] === "log") {
			return result({ stdout: `${HEAD}\n` });
		}
		if (args[0] === "rev-list") {
			return result({ stdout: `${HEAD} ${BASE}\n` });
		}
		if (args[0] === "rev-parse") {
			return result({ stdout: `${BASE}\n` });
		}
		assert.notEqual(command, "pnpm");
		return result();
	};
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, []);
	assert.deepEqual(plan.workers, []);
	assert.equal(plan.kubernetes, true);
});

test("maps Dockerfiles explicitly when they share a Turbo configuration commit", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (command, args) => {
		if (args[0] === "diff") {
			return result({
				stdout: changed("turbo.json", "apps/agent-runtime/Dockerfile", "apps/ops-web/Dockerfile"),
			});
		}
		if (args[0] === "log") {
			return result({ stdout: `${HEAD}\n` });
		}
		if (args[0] === "rev-list") {
			return result({ stdout: `${HEAD} ${BASE}\n` });
		}
		if (args[0] === "rev-parse") {
			return result({ stdout: `${BASE}\n` });
		}
		assert.notEqual(command, "pnpm");
		return result();
	};
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, ["agent-runtime", "ops-web"]);
	assert.deepEqual(plan.workers, []);
});

test("promotion planning remains diff-based even when all workers are active", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (command, args) => {
		if (command === "pnpm") {
			return result({ stdout: JSON.stringify({ tasks: [] }) });
		}
		if (args[0] === "diff") {
			return result({ stdout: changed("apps/agent-runtime/src/index.ts") });
		}
		return result();
	};
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, []);
	assert.deepEqual(plan.workers, []);
});

test("validation-only mode selects the active GitOps Workers", async (t) => {
	const root = await fixture(t);
	const plan = await planCandidates({ ...options(root), validateOnly: true }, () => result());
	assert.deepEqual(plan.workers, ["app-api-staging", "campus-web-staging"]);
	assert.equal(plan.validateOnly, true);
});

test("Campus Web docs refresh unions only the active Campus Worker into the diff plan", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (command, args) => {
		if (command === "pnpm") {
			return result({ stdout: JSON.stringify({ tasks: [] }) });
		}
		if (args[0] === "diff") {
			return result({ stdout: changed("apps/agent-runtime/src/index.ts") });
		}
		return result();
	};
	const plan = await planCandidates({ ...options(root), refreshCampusWebDocs: true }, runner);
	assert.deepEqual(plan.images, []);
	assert.deepEqual(plan.workers, ["campus-web-staging"]);
});

test("Campus Web docs refresh works when the GitOps cursor already equals head", async (t) => {
	const root = await fixture(t);
	const plan = await planCandidates(
		{ ...options(root), head: BASE, refreshCampusWebDocs: true },
		() => result(),
	);
	assert.deepEqual(plan, {
		base: BASE,
		head: BASE,
		images: [],
		kubernetes: false,
		validateOnly: false,
		workers: ["campus-web-staging"],
	});
});

test("Campus Web docs refresh rejects validation-only mode and an inactive Worker", async (t) => {
	const root = await fixture(t);
	await assert.rejects(
		planCandidates({ ...options(root), refreshCampusWebDocs: true, validateOnly: true }),
		/cannot run in validation-only mode/u,
	);
	await writeFile(
		path.join(root, "worker-versions.json"),
		`${JSON.stringify({
			schemaVersion: 2,
			workers: { "app-api-staging": { sourceSha: BASE, versionId: "app-api-version" } },
		})}\n`,
	);
	await assert.rejects(
		planCandidates({ ...options(root), refreshCampusWebDocs: true }),
		/requires an active campus-web-staging Worker/u,
	);
});

test("rejects active Workers without a Source publisher", async (t) => {
	const root = await fixture(t);
	await writeFile(
		path.join(root, "worker-versions.json"),
		`${JSON.stringify({
			schemaVersion: 2,
			workers: { "unknown-staging": { sourceSha: BASE, versionId: "unknown" } },
		})}\n`,
	);
	await assert.rejects(
		planCandidates(options(root), () => result()),
		/Unsupported active Worker: unknown-staging/u,
	);
});

test("selects Docker-only schema and Go images", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (command, args) => {
		if (command === "pnpm") {
			return result({ stdout: JSON.stringify({ tasks: [] }) });
		}
		if (args[0] === "diff") {
			return result({
				stdout: changed(
					"apps/app-api/ops/db/schema.ts",
					"apps/execution-control/internal/schemamigrations/migrator.go",
				),
			});
		}
		return result();
	};
	assert.deepEqual(await planCandidates(options(root), runner), {
		base: BASE,
		head: HEAD,
		images: ["app-api-schema", "execution-control"],
		kubernetes: false,
		validateOnly: false,
		workers: [],
	});
});

test("does not publish artifacts for an artifact adapter test change", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (command, args) => {
		if (command === "pnpm") {
			return result({ stdout: JSON.stringify({ tasks: [] }) });
		}
		if (args[0] === "diff") {
			return result({ stdout: changed("scripts/ci/check-ops-web-artifact.test.mjs") });
		}
		return result();
	};
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, []);
});

test("a Node lockfile change does not select the independent Go image", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (command, args) => {
		if (command === "pnpm") {
			return result({
				stdout: JSON.stringify({
					tasks: [
						{ command: "<NONEXISTENT>", package: "app-api-schema", task: "build" },
						{ command: "<NONEXISTENT>", package: "execution-control", task: "build" },
					],
				}),
			});
		}
		if (args[0] === "diff") {
			return result({ stdout: changed("pnpm-lock.yaml") });
		}
		return result();
	};
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, ["app-api-schema"]);
});

test("rejects a release base that is not an ancestor of head", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (_command, args) =>
		args[0] === "merge-base" ? result({ status: 1 }) : result();
	await assert.rejects(planCandidates(options(root), runner), /merge-base/u);
});

test("an already selected Source revision has no automatic candidates", async (t) => {
	const root = await fixture(t);
	let turboCalled = false;
	const runner: CommandRunner = (command) => {
		turboCalled ||= command === "pnpm";
		return result();
	};
	assert.deepEqual(await planCandidates({ ...options(root), head: BASE }, runner), {
		base: BASE,
		head: BASE,
		images: [],
		kubernetes: false,
		validateOnly: false,
		workers: [],
	});
	assert.equal(turboCalled, false);
});

test("an explicit PR base does not require a GitOps checkout", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = () => result();
	assert.deepEqual(
		await planCandidates(
			{
				base: BASE,
				head: BASE,
				refreshCampusWebDocs: false,
				repositoryRoot: root,
				validateOnly: false,
			},
			runner,
		),
		{
			base: BASE,
			head: BASE,
			images: [],
			kubernetes: false,
			validateOnly: false,
			workers: [],
		},
	);
});

test("candidate planning rejects ambiguous base ownership", async (t) => {
	const root = await fixture(t);
	await assert.rejects(
		planCandidates({ ...options(root), base: BASE }),
		/exactly one base or GitOps release selection/u,
	);
});
