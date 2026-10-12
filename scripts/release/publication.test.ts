import assert from "node:assert/strict";
import test from "node:test";
import type { CandidatePlan } from "./candidates.mts";
import {
	decidePublication,
	type PublicationIO,
	type PublicationRun,
	validatePublicationArtifacts,
} from "./publication.mts";

const sha = "a".repeat(40);
const plan: CandidatePlan = {
	head: sha,
	base: "b".repeat(40),
	images: ["model-config"],
	workers: ["app-api-staging"],
	sourceBases: [],
	topologyMigrations: [],
};
const run: PublicationRun = {
	id: 10,
	run_attempt: 1,
	head_sha: sha,
	head_branch: "main",
	event: "push",
	path: ".github/workflows/execution-runtime-publish.yml",
	status: "completed",
	conclusion: "success",
	head_repository: { full_name: "MUC-WIKI/campus-agent" },
};
const input = { plan, event: "push", currentRunId: 20 };
function io(overrides: Partial<PublicationIO> = {}): PublicationIO {
	return {
		async runs() {
			return [run];
		},
		async run() {
			return run;
		},
		async jobs() {
			return ["release-plan", "publish-images", "candidate-status", "dispatch-gitops-release"].map(
				(name) => ({
					name,
					conclusion: name === "dispatch-gitops-release" ? "failure" : "success",
				}),
			);
		},
		async artifacts() {
			return ["release-image-digests", "source-release"].map((name) => ({
				name,
				expired: false,
			}));
		},
		async readArtifact(_id, name) {
			return name === "release-image-digests"
				? { "image-digests.json": { "model-config": `sha256:${"c".repeat(64)}` } }
				: { "source-release.json": { ...plan, imageRunId: 10 } };
		},
		...overrides,
	};
}

test("duplicate push skips a handoff for the same release cursor", async () => {
	assert.deepEqual(
		await decidePublication(
			input,
			io({
				async jobs() {
					return (await io().jobs(run)).map((job) => ({
						...job,
						conclusion: "success",
						steps: [{ name: "Complete staging handoff", conclusion: "success" }],
					}));
				},
				async readArtifact(id, name) {
					assert.equal(name, "source-release");
					return io().readArtifact(id, name);
				},
			}),
		),
		{ action: "skip", runId: 10 },
	);
});
test("failed promotion reuses complete publication without rebuilding", async () => {
	assert.deepEqual(await decidePublication(input, io()), { action: "reuse", runId: 10 });
});
test("first publication and failed publication run normally", async () => {
	assert.equal(
		(
			await decidePublication(
				input,
				io({
					async runs() {
						return [];
					},
				}),
			)
		).action,
		"publish",
	);
	for (const failed of ["release-plan", "publish-images"]) {
		assert.equal(
			(
				await decidePublication(
					input,
					io({
						async jobs() {
							return (await io().jobs(run)).map((job) =>
								job.name === failed ? { ...job, conclusion: "failure" } : job,
							);
						},
					}),
				)
			).action,
			"publish",
		);
	}
});
test("manual refresh bypasses automatic deduplication", async () => {
	assert.equal(
		(
			await decidePublication(
				{ ...input, event: "workflow_dispatch" },
				io({
					async runs() {
						throw new Error("must not query");
					},
				}),
			)
		).action,
		"publish",
	);
});
test("explicit recovery validates workflow identity and successful publication", async () => {
	const recovery = { ...input, event: "workflow_dispatch", recoveryRunId: 10 };
	assert.equal((await decidePublication(recovery, io())).action, "reuse");
	for (const changed of [
		{ head_sha: "d".repeat(40) },
		{ path: ".github/workflows/pr.yml" },
		{ head_repository: { full_name: "other/repo" } },
	]) {
		await assert.rejects(
			decidePublication(
				recovery,
				io({
					async run() {
						return { ...run, ...changed };
					},
				}),
			),
			/does not match/,
		);
	}
	await assert.rejects(
		decidePublication(
			recovery,
			io({
				async jobs() {
					return [];
				},
			}),
		),
		/No complete publication/,
	);
});
test("missing, expired or mismatched candidates fail instead of silently republishing", async () => {
	await assert.rejects(
		decidePublication(
			input,
			io({
				async artifacts() {
					return [];
				},
			}),
		),
		/unavailable/,
	);
	await assert.rejects(
		decidePublication(
			input,
			io({
				async artifacts() {
					return [{ name: "release-image-digests", expired: true }];
				},
			}),
		),
		/unavailable/,
	);
	assert.throws(() => validatePublicationArtifacts(plan, {}), /digest/);
});
test("downloads only the artifact kinds needed by the current cumulative plan", async () => {
	for (const selected of [
		{ ...plan, workers: [] },
		{ ...plan, images: [] },
		{ ...plan, images: [], workers: [], sourceBases: ["infra/k8s/model-config/base"] },
	] satisfies CandidatePlan[]) {
		const reads: string[] = [];
		await decidePublication(
			{ ...input, plan: selected },
			io({
				async readArtifact(id, name) {
					reads.push(name);
					return io().readArtifact(id, name);
				},
			}),
		);
		assert.deepEqual(reads, [...(selected.images.length > 0 ? ["release-image-digests"] : [])]);
	}
});
test("rerun looks at its completed previous attempt", async () => {
	const rerun = { ...run, id: 20, run_attempt: 2, status: "in_progress" };
	await decidePublication(
		input,
		io({
			async runs() {
				return [rerun];
			},
			async jobs(producer) {
				assert.equal(producer.run_attempt, 1);
				return io().jobs(producer);
			},
		}),
	);
});
test("a failed reuse run does not hide the original artifact producer", async () => {
	assert.equal(
		(
			await decidePublication(
				input,
				io({
					async runs() {
						return [{ ...run, id: 15 }, run];
					},
					async jobs(producer) {
						return (await io().jobs(producer)).map((job) =>
							producer.id === 15 && job.name.startsWith("publish-")
								? { ...job, conclusion: "skipped" }
								: job,
						);
					},
				}),
			)
		).runId,
		10,
	);
});

test("status finalization failure reuses successful publication", async () => {
	const decision = await decidePublication(
		input,
		io({
			async jobs() {
				return (await io().jobs(run)).map((job) =>
					job.name === "candidate-status" ? { ...job, conclusion: "failure" } : job,
				);
			},
		}),
	);
	assert.equal(decision.action, "reuse");
});

test("repeated failed recovery attempts find the original successful publication", async () => {
	const visited: number[] = [];
	const decision = await decidePublication(
		input,
		io({
			async runs() {
				return [{ ...run, id: 20, run_attempt: 3 }];
			},
			async jobs(attempt) {
				visited.push(attempt.run_attempt);
				return (await io().jobs(attempt)).map((job) =>
					attempt.run_attempt === 2 && job.name.startsWith("publish-")
						? { ...job, conclusion: "skipped" }
						: job,
				);
			},
		}),
	);
	assert.deepEqual(visited, [2, 1]);
	assert.deepEqual(decision, { action: "reuse", runId: 20 });
});

test("a failed new publication cannot reuse overwritten artifacts from its older attempt", async () => {
	const attempts: number[] = [];
	const decision = await decidePublication(
		input,
		io({
			async runs() {
				return [{ ...run, id: 20, run_attempt: 3 }];
			},
			async jobs(attempt) {
				attempts.push(attempt.run_attempt);
				return (await io().jobs(attempt)).map((job) =>
					attempt.run_attempt === 2 && job.name === "publish-images"
						? { ...job, conclusion: "failure" }
						: job,
				);
			},
		}),
	);
	assert.equal(decision.action, "publish");
	assert.deepEqual(attempts, [2]);
});

test("explicit recovery restores same-SHA App API and Campus Web refresh candidates", async () => {
	for (const worker of ["app-api-staging", "campus-web-staging"] as const) {
		const reads: string[] = [];
		const decision = await decidePublication(
			{
				plan: { ...plan, images: [], workers: [] },
				event: "workflow_dispatch",
				currentRunId: 20,
				recoveryRunId: 10,
			},
			io({
				async jobs() {
					return (await io().jobs(run)).map((job) =>
						job.name === "publish-images" ? { ...job, conclusion: "skipped" } : job,
					);
				},
				async readArtifact(_id, name) {
					reads.push(name);
					return { "source-release.json": { ...plan, workers: [worker], imageRunId: 10 } };
				},
			}),
		);
		assert.deepEqual(decision, { action: "reuse", runId: 10, workers: [worker] });
		assert.deepEqual(reads, ["source-release"]);
	}
});

test("explicit recovery fails on unavailable or invalid refresh artifacts even with an empty diff", async () => {
	for (const defect of ["missing", "expired", "empty", "wrong-sha", "unknown-worker"]) {
		await assert.rejects(
			decidePublication(
				{
					plan: { ...plan, images: [], workers: [] },
					event: "workflow_dispatch",
					currentRunId: 20,
					recoveryRunId: 10,
				},
				io({
					async jobs() {
						return (await io().jobs(run)).map((job) =>
							job.name === "publish-images" ? { ...job, conclusion: "skipped" } : job,
						);
					},
					async artifacts() {
						return defect === "missing"
							? []
							: [{ name: "source-release", expired: defect === "expired" }];
					},
					async readArtifact() {
						return defect === "empty"
							? {}
							: {
									"source-release.json": {
										...plan,
										head: defect === "wrong-sha" ? "b".repeat(40) : sha,
										workers: defect === "unknown-worker" ? ["unknown"] : plan.workers,
										imageRunId: 10,
									},
								};
					},
				}),
			),
			/unavailable|empty|mismatched|Unsupported/,
			defect,
		);
	}
});

// B merged while C's asynchronous GitOps publication was queued. C's new
// release-plan uses B as base, while its previous dispatch still selected A.
test("a newer release cursor reuses image candidates and permits a new handoff", async () => {
	const nextPlan = {
		...plan,
		base: "d".repeat(40),
		workers: ["campus-web-staging"] as CandidatePlan["workers"],
	};
	const reads: string[] = [];
	const decision = await decidePublication(
		{ ...input, plan: nextPlan },
		io({
			async jobs() {
				return (await io().jobs(run)).map((job) => ({ ...job, conclusion: "success" }));
			},
			async readArtifact(id, name) {
				reads.push(name);
				return io().readArtifact(id, name);
			},
		}),
	);
	assert.deepEqual(decision, { action: "reuse", runId: 10 });
	assert.deepEqual(reads, ["source-release", "release-image-digests"]);
	assert.equal(decision.workers, undefined, "the new plan, not the old handoff, selects Workers");
});

test("cursor movement exposing an unpublished revert publishes the missing image", async () => {
	const nextPlan = { ...plan, base: "d".repeat(40), images: ["agent-runtime"] };
	const decision = await decidePublication(
		{ ...input, plan: nextPlan },
		io({
			async jobs() {
				return (await io().jobs(run)).map((job) => ({ ...job, conclusion: "success" }));
			},
		}),
	);
	assert.deepEqual(decision, { action: "publish", runId: 20 });
});

test("a fully selected duplicate does not need expired handoff artifacts", async () => {
	const selected = { ...plan, base: sha, images: [], workers: [], sourceBases: [] };
	const decision = await decidePublication(
		{ ...input, plan: selected },
		io({
			async jobs() {
				return (await io().jobs(run)).map((job) => ({ ...job, conclusion: "success" }));
			},
			async artifacts() {
				throw new Error("already selected");
			},
		}),
	);
	assert.deepEqual(decision, { action: "skip", runId: 10 });
});

test("an earlier empty publication cannot suppress changes exposed by a newer cursor", async () => {
	const decision = await decidePublication(
		input,
		io({
			async jobs() {
				return [
					{ name: "release-plan", conclusion: "success" },
					...["publish-images", "candidate-status", "dispatch-gitops-release"].map((name) => ({
						name,
						conclusion: "skipped",
					})),
				];
			},
		}),
	);
	assert.deepEqual(decision, { action: "publish", runId: 20 });
});
