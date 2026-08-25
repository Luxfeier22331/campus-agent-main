import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { type CommandResult, type CommandRunner, planCandidates } from "./candidates.mts";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const SYNTHETIC_TREE = "c".repeat(40);
const SYNTHETIC_BASE = "d".repeat(40);
const SYNTHETIC_HEAD = "e".repeat(40);

function result(overrides: Partial<CommandResult> = {}): CommandResult {
	return { status: 0, stderr: "", stdout: "", ...overrides };
}

function changed(...files: string[]): string {
	return `${files.flatMap((file) => ["M", file]).join("\0")}\0`;
}

function syntheticScopeRunner(
	diff: string,
	tasks: Array<{ command: string; package: string; task: string }>,
): CommandRunner {
	let commitCount = 0;
	return (command, args) => {
		if (command === "git" && args[0] === "diff") {
			return result({ stdout: diff });
		}
		if (command === "git" && args[0] === "ls-tree") {
			return result({ stdout: `100644 blob ${SYNTHETIC_TREE}\t${args.at(-1)}\0` });
		}
		if (command === "git" && ["read-tree", "update-index"].includes(args[0] ?? "")) {
			return result();
		}
		if (command === "git" && args[0] === "write-tree") {
			return result({ stdout: `${SYNTHETIC_TREE}\n` });
		}
		if (command === "git" && args[0] === "rev-parse") {
			return result({ stdout: `${SYNTHETIC_TREE}\n` });
		}
		if (command === "git" && args[0] === "commit-tree") {
			commitCount += 1;
			return result({ stdout: `${commitCount === 1 ? SYNTHETIC_BASE : SYNTHETIC_HEAD}\n` });
		}
		if (command === "pnpm") {
			return result({ stdout: JSON.stringify({ tasks }) });
		}
		return result();
	};
}

async function fixture(t: test.TestContext): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "candidate-plan-"));
	t.after(() => rm(root, { force: true, recursive: true }));
	await writeFile(
		path.join(root, "selection.json"),
		`${JSON.stringify({ repository: "MUC-WIKI/campus-agent", sourceSha: BASE })}\n`,
	);
	return root;
}

function options(root: string) {
	return {
		head: HEAD,
		refreshCampusWebDocs: false,
		repositoryRoot: root,
		selectionFile: path.join(root, "selection.json"),
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
						{ command: "tsc", package: "internal-portal-collection", task: "build" },
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
		images: ["agent-runtime", "internal-portal-collection"],
		sourceBases: ["infra/k8s/execution-runtime/base/runtime"],
		topologyMigrations: [],
		workers: ["app-api-staging", "campus-web-staging"],
	});
});

test("publishes collection image when a bundled workspace dependency changes", async (t) => {
	const root = await fixture(t);
	const runner = syntheticScopeRunner(changed("packages/internal-portal-client/src/portal.ts"), [
		{ command: "tsc", package: "internal-portal-collection", task: "build" },
	]);
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, ["internal-portal-collection"]);
	assert.deepEqual(plan.workers, []);
});

test("selects newly declared topology retirements without replaying old entries", async (t) => {
	const root = await fixture(t);
	await mkdir(path.join(root, "infra/k8s/topology"), { recursive: true });
	await writeFile(
		path.join(root, "infra/k8s/topology/retirements.json"),
		`${JSON.stringify(
			{
				schemaVersion: 1,
				retirements: [
					{
						id: "ingestion-control",
						operations: [
							{
								action: "remove-image",
								path: "clusters/staging/overlays/runtime/kustomization.yaml",
								image: "ghcr.io/muc-wiki/campus-agent/ingestion-control",
							},
						],
					},
				],
			},
			null,
			2,
		)}\n`,
	);
	const runner: CommandRunner = (command, args) => {
		if (command === "pnpm") {
			return result({ stdout: JSON.stringify({ tasks: [] }) });
		}
		if (command === "git" && args[0] === "diff") {
			return result({ stdout: changed("infra/k8s/topology/retirements.json") });
		}
		if (command === "git" && args[0] === "show") {
			return result({
				stdout: JSON.stringify({ schemaVersion: 1, retirements: [] }),
			});
		}
		return result();
	};
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.topologyMigrations, [
		{
			id: "ingestion-control",
			operations: [
				{
					action: "remove-image",
					path: "clusters/staging/overlays/runtime/kustomization.yaml",
					image: "ghcr.io/muc-wiki/campus-agent/ingestion-control",
				},
			],
		},
	]);
});

test("publishes the first product availability candidate before GitOps selects it", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (command, args) => {
		if (command === "pnpm") {
			return result({
				stdout: JSON.stringify({
					tasks: [{ command: "wrangler deploy", package: "status-web", task: "build:worker" }],
				}),
			});
		}
		if (args[0] === "diff") {
			return result({ stdout: changed("apps/status-web/src/index.ts") });
		}
		return result();
	};

	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.workers, ["status-web-staging"]);
});

test("task graph configuration does not publish business artifacts", async (t) => {
	const root = await fixture(t);
	const runner = syntheticScopeRunner(
		changed(
			"package.json",
			"turbo.json",
			"apps/execution-control/turbo.json",
			"infra/k8s/data-object-store/base/bootstrap.yaml",
		),
		[],
	);
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, []);
	assert.deepEqual(plan.workers, []);
	assert.deepEqual(plan.sourceBases, ["infra/k8s/data-object-store/base"]);
});

test("maps Turbo-owned Dockerfiles when they share a Turbo configuration commit", async (t) => {
	const root = await fixture(t);
	const runner = syntheticScopeRunner(
		changed("turbo.json", "apps/agent-runtime/Dockerfile", "apps/ops-web/Dockerfile"),
		[
			{ command: "build", package: "agent-runtime", task: "build" },
			{ command: "build", package: "ops-web", task: "build" },
		],
	);
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, ["agent-runtime", "ops-web"]);
	assert.deepEqual(plan.workers, []);
});

test("publishes the model-config image for source and Dockerfile changes", async (t) => {
	const root = await fixture(t);
	const runner = syntheticScopeRunner(
		changed("apps/model-config/internal/modelconfig/store.go", "apps/model-config/Dockerfile"),
		[],
	);
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, ["model-config"]);
	assert.deepEqual(plan.workers, []);
});

test("publishes all images when the shared Docker context changes", async (t) => {
	const root = await fixture(t);
	const runner = syntheticScopeRunner(changed(".dockerignore"), []);
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, [
		"agent-runtime",
		"app-api-schema",
		"campus-docs-index-publisher",
		"execution-control",
		"internal-portal-collection",
		"model-config",
		"notice-classifier",
		"notice-publisher",
		"ops-web",
	]);
	assert.deepEqual(plan.workers, []);
});

test("publishes the internal-portal-collection image for a Dockerfile-only change", async (t) => {
	const root = await fixture(t);
	const runner = syntheticScopeRunner(changed("jobs/internal-portal-collection/Dockerfile"), []);
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, ["internal-portal-collection"]);
	assert.deepEqual(plan.workers, []);
});

test("publishes the notice classifier image for its source or Dockerfile change", async (t) => {
	const root = await fixture(t);
	const runner = syntheticScopeRunner(
		changed("jobs/notice-classifier/src/job.ts", "jobs/notice-classifier/Dockerfile"),
		[],
	);
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, ["notice-classifier"]);
	assert.deepEqual(plan.workers, []);
});

test("publishes the notice publisher image for its source or Dockerfile change", async (t) => {
	const root = await fixture(t);
	const runner = syntheticScopeRunner(
		changed("jobs/notice-publisher/src/publisher.ts", "jobs/notice-publisher/Dockerfile"),
		[],
	);
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, ["notice-publisher"]);
	assert.deepEqual(plan.workers, []);
});

test("publishes all notice jobs when the shared notice database package changes", async (t) => {
	const root = await fixture(t);
	const runner = syntheticScopeRunner(changed("packages/notice-database/src/index.ts"), []);
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, [
		"internal-portal-collection",
		"notice-classifier",
		"notice-publisher",
	]);
	assert.deepEqual(plan.workers, []);
});

test("promotion planning remains diff-based", async (t) => {
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

test("Campus Web docs refresh unions the Campus Worker into the diff plan", async (t) => {
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

test("Campus map contract changes publish only Campus Web", async (t) => {
	const root = await fixture(t);
	const runner = syntheticScopeRunner(
		changed("apps/campus-web/assets/campus-map/manifest.json"),
		[],
	);
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.workers, ["campus-web-staging"]);
});

test("Campus map snapshot and query changes do not publish Campus Web", async (t) => {
	const root = await fixture(t);
	const runner = syntheticScopeRunner(
		changed(
			"apps/campus-web/data/campus-map/snapshots/fengtai.overpass.json",
			"apps/campus-web/data/campus-map/queries/fengtai.ql",
		),
		[],
	);
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.workers, []);
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
		sourceBases: [],
		topologyMigrations: [],
		workers: ["campus-web-staging"],
	});
});

test("selects Docker-only schema, publisher, and Go images", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (command, args) => {
		if (command === "pnpm") {
			return result({ stdout: JSON.stringify({ tasks: [] }) });
		}
		if (args[0] === "diff") {
			return result({
				stdout: changed(
					"apps/app-api/ops/db/schema.ts",
					"apps/campus-web/src/docs-reader-build/source-schema.ts",
					"apps/execution-control/internal/schemamigrations/migrator.go",
				),
			});
		}
		return result();
	};
	assert.deepEqual(await planCandidates(options(root), runner), {
		base: BASE,
		head: HEAD,
		images: ["app-api-schema", "campus-docs-index-publisher", "execution-control"],
		sourceBases: [],
		topologyMigrations: [],
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
			return result({ stdout: changed("scripts/release/check-ops-web-artifact.test.mjs") });
		}
		return result();
	};
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, []);
});

test("a Node lockfile change selects Node one-shot images but not the independent Go image", async (t) => {
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
	assert.deepEqual(plan.images, [
		"app-api-schema",
		"campus-docs-index-publisher",
		"internal-portal-collection",
		"notice-publisher",
	]);
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
		sourceBases: [],
		topologyMigrations: [],
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
			},
			runner,
		),
		{
			base: BASE,
			head: BASE,
			images: [],
			sourceBases: [],
			topologyMigrations: [],
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
