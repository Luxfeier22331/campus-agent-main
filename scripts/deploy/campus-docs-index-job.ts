import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type StageInput =
	| { stage: "chunks" }
	| { chunkSet: string; reuseEmbeddingSet?: string; stage: "embeddings" }
	| { embeddingSet: string; stage: "publish" };

const SHA256_REF = /^sha256:[a-f0-9]{64}$/u;

export function parseStageInput(argv: string[]): StageInput {
	const flags = parseFlags(argv);
	const stage = flags.get("--stage");
	if (stage === "chunks") {
		assertOnlyFlags(flags, ["--stage"]);
		return { stage };
	}
	if (stage === "embeddings") {
		assertOnlyFlags(flags, ["--stage", "--chunk-set", "--reuse-embedding-set"]);
		const chunkSet = requiredRef(flags, "--chunk-set");
		const reuseEmbeddingSet = flags.get("--reuse-embedding-set");
		return {
			chunkSet,
			stage,
			...(reuseEmbeddingSet
				? { reuseEmbeddingSet: assertRef(reuseEmbeddingSet, "--reuse-embedding-set") }
				: {}),
		};
	}
	if (stage === "publish") {
		assertOnlyFlags(flags, ["--stage", "--embedding-set"]);
		return {
			embeddingSet: requiredRef(flags, "--embedding-set"),
			stage,
		};
	}
	throw usageError();
}

export function stageTemplate(input: StageInput): {
	args: string[];
	cronJob: string;
	jobPrefix: string;
} {
	switch (input.stage) {
		case "chunks":
			return {
				args: ["build-chunks"],
				cronJob: "campus-docs-chunk-builder",
				jobPrefix: "campus-docs-chunks",
			};
		case "embeddings":
			return {
				args: [
					"build-embeddings",
					"--chunk-set",
					input.chunkSet,
					...(input.reuseEmbeddingSet ? ["--reuse-embedding-set", input.reuseEmbeddingSet] : []),
				],
				cronJob: "campus-docs-embedding-builder",
				jobPrefix: "campus-docs-embeddings",
			};
		case "publish":
			return {
				args: ["publish-index", "--embedding-set", input.embeddingSet],
				cronJob: "campus-docs-index-publisher",
				jobPrefix: "campus-docs-publish",
			};
		default:
			throw new Error("Unknown Campus Docs Job stage.");
	}
}

export function main(argv: string[] = process.argv.slice(2)): number {
	let input: StageInput;
	try {
		input = parseStageInput(argv);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
	const template = stageTemplate(input);
	const timestamp = new Date()
		.toISOString()
		.replaceAll(/[-:TZ.]/gu, "")
		.slice(0, 14);
	const jobName = `${template.jobPrefix}-${timestamp}`;
	const rendered = spawnSync(
		"kubectl",
		[
			"create",
			"job",
			`--from=cronjob/${template.cronJob}`,
			jobName,
			"--dry-run=client",
			"-o",
			"json",
		],
		{ encoding: "utf8" },
	);
	if (rendered.status !== 0 || !rendered.stdout) {
		console.error("Unable to render the Campus Docs Job from its CronJob template.");
		return rendered.status ?? 1;
	}
	let job: Record<string, unknown>;
	try {
		job = JSON.parse(rendered.stdout) as Record<string, unknown>;
		setContainerArgs(job, template.args);
	} catch (error) {
		console.error(error instanceof Error ? error.message : "Rendered Campus Docs Job is invalid.");
		return 1;
	}
	const created = spawnSync("kubectl", ["create", "-f", "-"], {
		input: JSON.stringify(job),
		stdio: ["pipe", "inherit", "inherit"],
	});
	return created.status ?? 1;
}

function setContainerArgs(job: Record<string, unknown>, args: string[]): void {
	const spec = record(job.spec, "rendered Job spec");
	const template = record(spec.template, "rendered Job template");
	const podSpec = record(template.spec, "rendered Job pod spec");
	if (!Array.isArray(podSpec.containers) || podSpec.containers.length !== 1) {
		throw new Error("Rendered Campus Docs Job must contain exactly one container.");
	}
	const container = record(podSpec.containers[0], "rendered Job container");
	container.args = args;
}

function parseFlags(argv: string[]): Map<string, string> {
	if (argv.length === 0 || argv.length % 2 !== 0) {
		throw usageError();
	}
	const flags = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const name = argv[index];
		const value = argv[index + 1];
		if (!(name?.startsWith("--") && value) || flags.has(name)) {
			throw usageError();
		}
		flags.set(name, value);
	}
	return flags;
}

function requiredRef(flags: Map<string, string>, name: string): string {
	const value = flags.get(name);
	if (!value) {
		throw usageError();
	}
	return assertRef(value, name);
}

function assertRef(value: string, name: string): string {
	if (!SHA256_REF.test(value)) {
		throw new Error(`${name} must be sha256:<64 lowercase hex characters>.`);
	}
	return value;
}

function assertOnlyFlags(flags: Map<string, string>, allowed: readonly string[]): void {
	for (const flag of flags.keys()) {
		if (!allowed.includes(flag)) {
			throw usageError();
		}
	}
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} is invalid.`);
	}
	return value as Record<string, unknown>;
}

function usageError(): Error {
	return new Error(
		"Usage: pnpm campus-docs:index-job -- --stage chunks | --stage embeddings --chunk-set sha256:<id> [--reuse-embedding-set sha256:<id>] | --stage publish --embedding-set sha256:<id>",
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	process.exit(main(process.argv.slice(2)));
}
