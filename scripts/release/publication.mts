import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CandidatePlan } from "./candidates.mts";
import { parseWorkerCandidates } from "./workers.mts";

const WORKFLOW = ".github/workflows/execution-runtime-publish.yml";
const REPOSITORY = "MUC-WIKI/campus-agent";

export interface PublicationRun {
	id: number;
	run_attempt: number;
	head_sha: string;
	head_branch: string;
	event: string;
	path: string;
	status: string;
	conclusion: string | null;
	head_repository: { full_name: string };
}
export interface PublicationJob {
	name: string;
	conclusion: string | null;
	steps?: Array<{ name: string; conclusion: string | null }>;
}
export interface PublicationArtifact {
	name: string;
	expired: boolean;
}
export interface PublicationIO {
	runs(sha: string): Promise<PublicationRun[]>;
	run(id: number): Promise<PublicationRun>;
	jobs(run: PublicationRun): Promise<PublicationJob[]>;
	artifacts(id: number): Promise<PublicationArtifact[]>;
	readArtifact(id: number, name: string): Promise<Record<string, unknown>>;
}
export interface PublicationDecision {
	action: "publish" | "reuse" | "skip";
	runId: number;
	workers?: CandidatePlan["workers"];
}

export function validatePublicationArtifacts(
	plan: CandidatePlan,
	images: unknown,
	workers: Record<string, unknown>,
): void {
	if (plan.images.length > 0) {
		if (!images || typeof images !== "object" || Array.isArray(images)) {
			throw new Error("Invalid image candidate artifact");
		}
		for (const name of plan.images) {
			if (!/^sha256:[a-f0-9]{64}$/u.test(String((images as Record<string, unknown>)[name]))) {
				throw new Error(`Missing or invalid published digest for ${name}`);
			}
		}
	}
	for (const name of plan.workers) {
		const candidate = workers[`${name}.json`] as Record<string, unknown> | undefined;
		if (
			!candidate ||
			candidate.workerName !== name ||
			candidate.sourceSha !== plan.head ||
			typeof candidate.versionId !== "string" ||
			!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(candidate.versionId)
		) {
			throw new Error(`Missing or mismatched published Worker candidate: ${name}`);
		}
	}
}

export async function decidePublication(
	input: {
		plan: CandidatePlan;
		event: string;
		currentRunId: number;
		recoveryRunId?: number;
	},
	io: PublicationIO,
): Promise<PublicationDecision> {
	if (input.event !== "push" && !input.recoveryRunId) {
		return { action: "publish", runId: input.currentRunId };
	}
	const matchingRuns = input.recoveryRunId
		? [await io.run(input.recoveryRunId)]
		: (await io.runs(input.plan.head))
				.filter((run) => run.id <= input.currentRunId)
				.sort((a, b) => b.id - a.id);
	// A rerun may itself have reused an earlier attempt. Keep looking backwards
	// until the actual producer (or completed handoff) is found.
	const runs = matchingRuns.flatMap((run) => {
		const attempts = run.run_attempt - (run.id === input.currentRunId ? 1 : 0);
		return Array.from({ length: attempts }, (_, index) => ({
			...run,
			run_attempt: attempts - index,
		}));
	});
	const replacedAttempts = new Set<number>();
	for (const run of runs) {
		if (replacedAttempts.has(run.id)) {
			continue;
		}
		if (
			run.head_sha !== input.plan.head ||
			run.head_branch !== "main" ||
			run.head_repository.full_name !== REPOSITORY ||
			run.path !== WORKFLOW ||
			(!input.recoveryRunId && run.event !== "push")
		) {
			if (input.recoveryRunId) {
				throw new Error("Recovery run does not match the Source workflow and SHA");
			}
			continue;
		}
		const attemptJobs = await io.jobs(run);
		const jobs = new Map(attemptJobs.map((job) => [job.name, job.conclusion]));
		// A new publication attempt may overwrite this run's artifacts, so older
		// attempts are usable only if the newer attempt did not publish anything.
		if (
			["publish-images", "publish-workers"].some((name) => {
				const result = jobs.get(name);
				return result !== undefined && result !== "skipped";
			})
		) {
			replacedAttempts.add(run.id);
		}
		const complete =
			jobs.get("release-plan") === "success" &&
			["publish-images", "publish-workers"].every((name) =>
				["success", "skipped"].includes(jobs.get(name) ?? ""),
			) &&
			(jobs.get("candidate-status") === "success" ||
				["publish-images", "publish-workers"].some((name) => jobs.get(name) === "success"));
		const empty =
			jobs.get("release-plan") === "success" &&
			["publish-images", "publish-workers", "candidate-status"].every(
				(name) => jobs.get(name) === "skipped",
			);
		if (!(complete || empty)) {
			continue;
		}
		const handedOff =
			jobs.get("promote") === "success" &&
			attemptJobs
				.find((job) => job.name === "promote")
				?.steps?.some(
					(step) =>
						["Complete staging handoff", "Mark staging promotion pending"].includes(step.name) &&
						step.conclusion === "success",
				);
		if (!input.recoveryRunId && (handedOff || empty)) {
			return { action: "skip", runId: run.id };
		}
		if (
			!input.recoveryRunId &&
			((input.plan.images.length > 0 && jobs.get("publish-images") !== "success") ||
				(input.plan.workers.length > 0 && jobs.get("publish-workers") !== "success"))
		) {
			continue;
		}
		const artifacts = await io.artifacts(run.id);
		const read = async (name: string, needed: boolean) => {
			if (!needed) {
				return {};
			}
			if (!artifacts.some((artifact) => artifact.name === name && !artifact.expired)) {
				throw new Error(
					`Published ${name} is unavailable; explicitly republish through workflow_dispatch if needed`,
				);
			}
			return io.readArtifact(run.id, name);
		};
		const images = await read("release-image-digests", input.plan.images.length > 0);
		// Explicit recovery restores the selected publication, including same-SHA
		// configuration refreshes that are absent from the current source diff.
		const recoverWorkers =
			Boolean(input.recoveryRunId) &&
			(jobs.get("publish-workers") === "success" ||
				artifacts.some((artifact) => artifact.name === "release-worker-candidates"));
		const workers = await read(
			"release-worker-candidates",
			input.plan.workers.length > 0 || recoverWorkers,
		);
		const selectedWorkers = recoverWorkers
			? [
					...new Set([
						...input.plan.workers,
						...parseWorkerCandidates(
							JSON.stringify(Object.keys(workers).map((file) => file.replace(/\.json$/u, ""))),
						),
					]),
				].sort()
			: input.plan.workers;
		if (recoverWorkers && Object.keys(workers).length === 0) {
			throw new Error("Published Worker candidate artifact is empty");
		}
		validatePublicationArtifacts(
			{ ...input.plan, workers: selectedWorkers },
			images["image-digests.json"],
			workers,
		);
		return {
			action: "reuse",
			runId: run.id,
			...(input.recoveryRunId ? { workers: selectedWorkers } : {}),
		};
	}
	if (input.recoveryRunId) {
		throw new Error("No complete publication is available for recovery");
	}
	return { action: "publish", runId: input.currentRunId };
}

function githubIO(): PublicationIO {
	const api = (endpoint: string) =>
		JSON.parse(
			execFileSync("gh", ["api", endpoint], {
				encoding: "utf8",
				maxBuffer: 16 * 1024 * 1024,
			}),
		);
	const pages = <T,>(endpoint: string, key: string): T[] => {
		const items: T[] = [];
		for (let page = 1; ; page++) {
			const batch = api(
				`${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
			)[key] as T[];
			if (!Array.isArray(batch)) {
				throw new Error(`Invalid GitHub ${key} response`);
			}
			items.push(...batch);
			if (batch.length < 100) {
				return items;
			}
		}
	};
	const prefix = `repos/${REPOSITORY}/actions`;
	return {
		async runs(sha) {
			return pages(
				`${prefix}/workflows/execution-runtime-publish.yml/runs?head_sha=${sha}&event=push`,
				"workflow_runs",
			);
		},
		async run(id) {
			return api(`${prefix}/runs/${id}`);
		},
		async jobs(run) {
			return pages(`${prefix}/runs/${run.id}/attempts/${run.run_attempt}/jobs`, "jobs");
		},
		async artifacts(id) {
			return pages(`${prefix}/runs/${id}/artifacts`, "artifacts");
		},
		async readArtifact(id, name) {
			const directory = await mkdtemp(path.join(os.tmpdir(), "source-candidate-"));
			try {
				execFileSync(
					"gh",
					["run", "download", String(id), "--repo", REPOSITORY, "--name", name, "--dir", directory],
					{ stdio: "pipe" },
				);
				const { readdir } = await import("node:fs/promises");
				return Object.fromEntries(
					await Promise.all(
						(await readdir(directory))
							.filter((file) => file.endsWith(".json"))
							.map(async (file) => [
								file,
								JSON.parse(await readFile(path.join(directory, file), "utf8")),
							]),
					),
				);
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		},
	};
}

async function main(): Promise<void> {
	const plan = JSON.parse(process.env.CANDIDATE_PLAN ?? "") as CandidatePlan;
	const currentRunId = Number(process.env.GITHUB_RUN_ID);
	const recoveryRunId = process.env.RECOVERY_RUN_ID
		? Number(process.env.RECOVERY_RUN_ID)
		: undefined;
	if (
		!Number.isSafeInteger(currentRunId) ||
		currentRunId <= 0 ||
		(recoveryRunId !== undefined && (!Number.isSafeInteger(recoveryRunId) || recoveryRunId <= 0))
	) {
		throw new Error("Expected a positive GitHub run ID");
	}
	const decision = await decidePublication(
		{
			plan,
			currentRunId,
			recoveryRunId,
			event: process.env.GITHUB_EVENT_NAME ?? "",
		},
		githubIO(),
	);
	if (process.env.GITHUB_OUTPUT) {
		await appendFile(
			process.env.GITHUB_OUTPUT,
			`action=${decision.action}\nrun_id=${decision.runId}\nworkers=${JSON.stringify(decision.workers ?? plan.workers)}\n`,
		);
	}
	console.log(JSON.stringify(decision));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
