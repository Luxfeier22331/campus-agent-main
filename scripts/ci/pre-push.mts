import path from "node:path";
import { pathToFileURL } from "node:url";

import { type EvidenceCommandRunner, runCommand, runPrePushEvidence } from "./evidence.mts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const ZERO_REF = "0".repeat(40);

export type PrePushPlan =
	| { kind: "delete" }
	| { head: string; kind: "full" }
	| { base: string; head: string; kind: "affected" };

function requiredRef(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name];
	if (!value) {
		throw new Error(`Missing ${name}`);
	}
	if (!SHA_PATTERN.test(value)) {
		throw new Error(`${name} must be a full lowercase commit SHA`);
	}
	return value;
}

function commandError(
	command: string,
	args: string[],
	status: number | null,
	detail?: string,
): Error {
	return new Error(
		command +
			" " +
			args.join(" ") +
			" failed: " +
			(detail?.trim() || `exit code ${String(status ?? 1)}`),
	);
}

// This adapter translates prek's push refs into the repository's affected evidence contract.
// Remove it if the evidence entrypoint accepts push ranges directly or the pre-push lane is retired.
export function planPrePush(
	input: { env: NodeJS.ProcessEnv; repositoryRoot: string },
	runner: EvidenceCommandRunner = runCommand,
): PrePushPlan {
	const from = requiredRef(input.env, "PRE_COMMIT_FROM_REF");
	const to = requiredRef(input.env, "PRE_COMMIT_TO_REF");
	if (to === ZERO_REF) {
		return { kind: "delete" };
	}
	if (from === ZERO_REF) {
		return { head: to, kind: "full" };
	}
	const args = ["merge-base", "--is-ancestor", from, to];
	const result = runner("git", args, {
		cwd: input.repositoryRoot,
		env: input.env,
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status === 0) {
		return { base: from, head: to, kind: "affected" };
	}
	if (result.status === 1) {
		return { head: to, kind: "full" };
	}
	throw commandError("git", args, result.status, result.stderr || result.stdout);
}

export function runPrePush(
	input: { env?: NodeJS.ProcessEnv; repositoryRoot?: string } = {},
	runner: EvidenceCommandRunner = runCommand,
): void {
	const env = input.env ?? process.env;
	const repositoryRoot = path.resolve(input.repositoryRoot ?? process.cwd());
	const plan = planPrePush({ env, repositoryRoot }, runner);
	if (plan.kind === "delete") {
		return;
	}
	runPrePushEvidence(
		{
			...(plan.kind === "affected" ? { base: plan.base } : {}),
			head: plan.head,
			repositoryRoot,
		},
		runner,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		runPrePush();
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
