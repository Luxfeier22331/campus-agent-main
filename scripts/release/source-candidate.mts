import { execFileSync, spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type CandidatePlan, planCandidates, SOURCE_BASE_PATHS } from "./candidates.mts";
import { ACTIVE_IMAGE_TARGETS } from "./image-targets.mts";
import {
	type TopologyMigrationPlan,
	validateTopologyRetirements,
} from "./topology-retirements.mts";
import { WORKER_CANDIDATES, type WorkerCandidate } from "./workers.mts";

export const CANDIDATE_REPOSITORY = "ghcr.io/muc-wiki/campus-agent/source-candidate";
export interface SourceCandidate {
	schemaVersion: 2;
	sourceSha: string;
	images: Record<string, { digest: string; sourceSha: string }>;
	sourceBases: string[];
	baseRevisions: Record<string, string>;
	workers: Record<WorkerCandidate, { sourceSha: string }>;
	topologyMigrations: TopologyMigrationPlan[];
	maintenanceRequirements: string[];
}
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
export function parseSourceCandidate(value: unknown): SourceCandidate {
	const candidate = value as SourceCandidate;
	if (candidate?.schemaVersion !== 2 || !SHA.test(candidate.sourceSha ?? "")) {
		throw new Error("Invalid Source candidate identity");
	}
	for (const name of ACTIVE_IMAGE_TARGETS) {
		const image = candidate.images?.[name];
		if (!(image && DIGEST.test(image.digest) && SHA.test(image.sourceSha))) {
			throw new Error(`Missing complete candidate image ${name}`);
		}
	}
	for (const name of WORKER_CANDIDATES) {
		if (!SHA.test(candidate.workers?.[name]?.sourceSha ?? "")) {
			throw new Error(`Missing candidate Worker ${name}`);
		}
	}
	if (
		!(
			Array.isArray(candidate.sourceBases) &&
			candidate.sourceBases.every((base) =>
				SOURCE_BASE_PATHS.includes(base as (typeof SOURCE_BASE_PATHS)[number]),
			)
		)
	) {
		throw new Error("Invalid Source bases");
	}
	for (const base of candidate.sourceBases) {
		if (!SHA.test(candidate.baseRevisions?.[base] ?? "")) {
			throw new Error(`Missing base revision ${base}`);
		}
	}
	const failures = validateTopologyRetirements({
		schemaVersion: 1,
		retirements: candidate.topologyMigrations,
	});
	if (failures.length > 0) {
		throw new Error(failures.join("\n"));
	}
	const requirements = candidate.maintenanceRequirements ?? [];
	if (
		!(
			Array.isArray(requirements) &&
			requirements.every((id) => typeof id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
		) ||
		new Set(requirements).size !== requirements.length
	) {
		throw new Error("Invalid candidate maintenance requirements");
	}
	return { ...candidate, maintenanceRequirements: [...requirements].sort() };
}

export function completeCandidate(
	plan: CandidatePlan,
	previous: SourceCandidate | undefined,
	digests: Record<string, string>,
	migrations: TopologyMigrationPlan[],
): SourceCandidate {
	const images: SourceCandidate["images"] = {};
	for (const name of ACTIVE_IMAGE_TARGETS) {
		if (plan.images.includes(name)) {
			const digest = digests[name] ?? "";
			if (!DIGEST.test(digest)) {
				throw new Error(`Missing published image ${name}`);
			}
			images[name] = { digest, sourceSha: plan.head };
		} else {
			if (!previous?.images[name]) {
				throw new Error(`No baseline for ${name}`);
			}
			images[name] = previous.images[name];
		}
	}
	const workers = Object.fromEntries(
		WORKER_CANDIDATES.map((name) => [
			name,
			plan.workers.includes(name) || !previous?.workers[name]
				? { sourceSha: plan.head }
				: previous.workers[name],
		]),
	) as SourceCandidate["workers"];
	return parseSourceCandidate({
		schemaVersion: 2,
		sourceSha: plan.head,
		images,
		workers,
		sourceBases: [...SOURCE_BASE_PATHS],
		baseRevisions: Object.fromEntries(
			SOURCE_BASE_PATHS.map((base) => [
				base,
				plan.sourceBases.includes(base) ? plan.head : (previous?.baseRevisions[base] ?? plan.head),
			]),
		),
		topologyMigrations: migrations,
		maintenanceRequirements: [...(plan.maintenanceRequirements ?? [])].sort(),
	});
}

const run = (command: string, args: string[], cwd = process.cwd()) =>
	execFileSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	}).trim();
async function main(): Promise<void> {
	const directory = path.resolve(process.env.CANDIDATE_DIRECTORY ?? ".candidate");
	await mkdir(directory, { recursive: true });
	const head = process.env.GITHUB_SHA ?? run("git", ["rev-parse", "HEAD"]);
	if (process.argv[2] === "plan") {
		// latest is only a discovery cursor; all handoffs use the pushed digest.
		const found = spawnSync("oras", ["manifest", "fetch", `${CANDIDATE_REPOSITORY}:latest`], {
			encoding: "utf8",
		});
		let previous: SourceCandidate | undefined;
		if (found.status === 0) {
			run("oras", ["pull", `${CANDIDATE_REPOSITORY}:latest`, "-o", directory]);
			previous = parseSourceCandidate(
				JSON.parse(await readFile(path.join(directory, "source-release.json"), "utf8")),
			);
			// A queued/re-run older commit must never move the publication cursor backwards.
			run("git", ["merge-base", "--is-ancestor", previous.sourceSha, head]);
		} else if (
			!/manifest unknown|not found|NAME_UNKNOWN|MANIFEST_UNKNOWN|404/i.test(found.stderr)
		) {
			throw new Error(`Cannot read Source candidate: ${found.stderr}`);
		}
		const plan = previous
			? await planCandidates({
					base: previous.sourceSha,
					head,
					refreshCampusWebDocs: false,
					repositoryRoot: process.cwd(),
				})
			: {
					base: head,
					head,
					images: [...ACTIVE_IMAGE_TARGETS],
					workers: [...WORKER_CANDIDATES],
					sourceBases: [...SOURCE_BASE_PATHS],
					topologyMigrations: [],
				};
		await writeFile(path.join(directory, "baseline.json"), JSON.stringify(previous ?? null));
		await writeFile(path.join(directory, "plan.json"), JSON.stringify(plan));
		if (process.env.GITHUB_OUTPUT) {
			await appendFile(process.env.GITHUB_OUTPUT, `images=${JSON.stringify(plan.images)}\n`);
		}
		return;
	}
	if (process.argv[2] !== "publish") {
		throw new Error("Usage: source-candidate plan|publish");
	}
	const plan = JSON.parse(
		await readFile(path.join(directory, "plan.json"), "utf8"),
	) as CandidatePlan;
	const previous = JSON.parse(
		await readFile(path.join(directory, "baseline.json"), "utf8"),
	) as SourceCandidate | null;
	const digests =
		plan.images.length > 0
			? JSON.parse(await readFile(path.join(directory, "image-digests.json"), "utf8"))
			: {};
	const retirements = JSON.parse(await readFile("infra/k8s/topology/retirements.json", "utf8"));
	const candidate = completeCandidate(
		plan,
		previous ?? undefined,
		digests,
		retirements.retirements,
	);
	await writeFile(path.join(directory, "source-release.json"), JSON.stringify(candidate, null, 2));
	const tag = `${head}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
	const pushed = JSON.parse(
		run(
			"oras",
			[
				"push",
				`${CANDIDATE_REPOSITORY}:${tag}`,
				"--annotation",
				"org.opencontainers.image.source=https://github.com/MUC-WIKI/campus-agent",
				"--artifact-type",
				"application/vnd.campus.source-candidate.v2+json",
				"source-release.json:application/json",
				"--format",
				"json",
			],
			directory,
		),
	);
	if (!DIGEST.test(pushed.digest)) {
		throw new Error("Registry did not return candidate digest");
	}
	run("oras", ["tag", `${CANDIDATE_REPOSITORY}@${pushed.digest}`, "latest"]);
	if (process.env.GITHUB_OUTPUT) {
		await appendFile(
			process.env.GITHUB_OUTPUT,
			`candidate_ref=${CANDIDATE_REPOSITORY}@${pushed.digest}\n`,
		);
	}
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}
