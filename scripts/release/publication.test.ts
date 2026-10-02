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
const candidate = {
	workerName: "app-api-staging",
	sourceSha: sha,
	versionId: "12345678-1234-1234-1234-123456789abc",
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
			return [
				"release-plan",
				"publish-images",
				"publish-workers",
				"candidate-status",
				"promote",
			].map((name) => ({ name, conclusion: name === "promote" ? "failure" : "success" }));
		},
		async artifacts() {
			return ["release-image-digests", "release-worker-candidates"].map((name) => ({
				name,
				expired: false,
			}));
		},
		async readArtifact(_id, name) {
			return name === "release-image-digests"
				? { "image-digests.json": { "model-config": `sha256:${"c".repeat(64)}` } }
				: { "app-api-staging.json": candidate };
		},
		...overrides,
	};
}

test("duplicate push skips a complete handoff without requiring retained artifacts", async () => {
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
				async artifacts() {
					throw new Error("must not read artifacts");
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
	for (const failed of ["release-plan", "publish-images", "publish-workers"]) {
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
	assert.throws(() => validatePublicationArtifacts(plan, {}, {}), /digest/);
	assert.throws(
		() =>
			validatePublicationArtifacts(
				{ ...plan, images: [] },
				{},
				{ "app-api-staging.json": { ...candidate, sourceSha: "b".repeat(40) } },
			),
		/mismatched/,
	);
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
		assert.deepEqual(reads, [
			...(selected.images.length > 0 ? ["release-image-digests"] : []),
			...(selected.workers.length > 0 ? ["release-worker-candidates"] : []),
		]);
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
					attempt.run_attempt === 2 && job.name === "publish-workers"
						? { ...job, conclusion: "failure" }
						: job,
				);
			},
		}),
	);
	assert.equal(decision.action, "publish");
	assert.deepEqual(attempts, [2]);
});

test("topology-required is not a completed handoff and reuses publication", async () => {
	const decision = await decidePublication(
		input,
		io({
			async jobs() {
				return (await io().jobs(run)).map((job) => ({
					...job,
					conclusion: "success",
					steps: [{ name: "Complete staging handoff", conclusion: "skipped" }],
				}));
			},
		}),
	);
	assert.deepEqual(decision, { action: "reuse", runId: 10 });
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
					return { [`${worker}.json`]: { ...candidate, workerName: worker } };
				},
			}),
		);
		assert.deepEqual(decision, { action: "reuse", runId: 10, workers: [worker] });
		assert.deepEqual(reads, ["release-worker-candidates"]);
	}
});

test("explicit recovery fails on unavailable or invalid refresh artifacts even with an empty diff", async () => {
	for (const defect of ["missing", "expired", "empty", "wrong-sha", "wrong-worker"]) {
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
							: [{ name: "release-worker-candidates", expired: defect === "expired" }];
					},
					async readArtifact() {
						return defect === "empty"
							? {}
							: {
									"app-api-staging.json": {
										...candidate,
										sourceSha: defect === "wrong-sha" ? "b".repeat(40) : sha,
										workerName:
											defect === "wrong-worker" ? "campus-web-staging" : candidate.workerName,
									},
								};
					},
				}),
			),
			/unavailable|empty|mismatched/,
			defect,
		);
	}
});
