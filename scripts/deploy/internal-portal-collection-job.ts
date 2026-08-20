import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type InternalPortalCollectionJobInput =
	| { mode: "notice-sync"; namespace: string }
	| {
			mode: "notice-backfill";
			namespace: string;
			startDate: string;
	  }
	| { mode: "file-sync"; namespace: string };

export function parseInternalPortalCollectionJobInput(
	argv: string[],
): InternalPortalCollectionJobInput {
	const flags = parseFlags(argv[0] === "--" ? argv.slice(1) : argv);
	const namespace = required(flags, "--namespace");
	const mode = required(flags, "--mode");
	if (mode === "notice-sync") {
		assertOnlyFlags(flags, ["--namespace", "--mode"]);
		return { mode, namespace };
	}
	if (mode === "notice-backfill") {
		assertOnlyFlags(flags, ["--namespace", "--mode", "--start-date"]);
		return {
			mode,
			namespace,
			startDate: parseStartDate(required(flags, "--start-date")),
		};
	}
	if (mode === "file-sync") {
		assertOnlyFlags(flags, ["--namespace", "--mode"]);
		return { mode, namespace };
	}
	throw usageError();
}

export function collectionJobTemplate(input: InternalPortalCollectionJobInput): {
	args: string[];
	cronJob: string;
	jobPrefix: string;
} {
	const cronJob = "internal-portal-collection";
	if (input.mode === "notice-sync") {
		return {
			args: ["--mode", input.mode],
			cronJob,
			jobPrefix: "internal-portal-notice-sync",
		};
	}
	if (input.mode === "notice-backfill") {
		return {
			args: ["--mode", input.mode, "--start-date", input.startDate],
			cronJob,
			jobPrefix: "internal-portal-notice-backfill",
		};
	}
	return {
		args: ["--mode", input.mode],
		cronJob,
		jobPrefix: "internal-portal-file-sync",
	};
}

export function main(argv: string[] = process.argv.slice(2)): number {
	let input: InternalPortalCollectionJobInput;
	try {
		input = parseInternalPortalCollectionJobInput(argv);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
	const template = collectionJobTemplate(input);
	const timestamp = new Date()
		.toISOString()
		.replaceAll(/[-:TZ.]/gu, "")
		.slice(0, 14);
	const jobName = `${template.jobPrefix}-${timestamp}`;
	const rendered = spawnSync(
		"kubectl",
		[
			"--namespace",
			input.namespace,
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
		console.error("Unable to render the internal portal collection Job template.");
		return rendered.status ?? 1;
	}
	let job: Record<string, unknown>;
	try {
		job = JSON.parse(rendered.stdout) as Record<string, unknown>;
		setContainerArgs(job, template.args);
	} catch (error) {
		console.error(
			error instanceof Error
				? error.message
				: "Rendered internal portal collection Job is invalid.",
		);
		return 1;
	}
	const created = spawnSync("kubectl", ["--namespace", input.namespace, "create", "-f", "-"], {
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
		throw new Error("Rendered internal portal collection Job must contain exactly one container.");
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

function required(flags: ReadonlyMap<string, string>, name: string): string {
	const value = flags.get(name)?.trim();
	if (!value) {
		throw usageError();
	}
	return value;
}

function parseStartDate(value: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
		throw usageError();
	}
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
		throw usageError();
	}
	return value;
}

function assertOnlyFlags(flags: ReadonlyMap<string, string>, allowed: readonly string[]): void {
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
		"Usage: pnpm internal-portal:collect:job -- --namespace <namespace> --mode notice-sync | --namespace <namespace> --mode notice-backfill --start-date YYYY-MM-DD | --namespace <namespace> --mode file-sync",
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	process.exit(main(process.argv.slice(2)));
}
