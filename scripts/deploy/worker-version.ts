import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runWranglerCommand } from "./run-wrangler-command.ts";
import { resolveGitSha } from "./staging-release.ts";

interface WorkerVersionSummary {
	id: string;
	metadata?: {
		created_on?: string;
	};
	annotations?: Record<string, string>;
}

interface WorkerDeploymentSummary {
	id: string;
}

export interface UploadedWorkerVersion {
	workerName: string;
	versionId: string;
	sourceSha: string;
}

function fail(message: string): never {
	throw new Error(message);
}

function parseJsonOutput<T>(stdout: string | Buffer | null, command: string): T {
	const text = String(stdout ?? "").trim();
	try {
		return JSON.parse(text) as T;
	} catch {
		return fail(`${command} did not return valid JSON.`);
	}
}

function readCurrentDeploymentId(cwd: string, workerName: string): string {
	const result = runWranglerCommand(["deployments", "status", "--name", workerName, "--json"], {
		cwd,
		stdio: "pipe",
	});
	if (result.status !== 0) {
		return fail(`Unable to read the current deployment for ${workerName}.`);
	}
	return parseJsonOutput<WorkerDeploymentSummary>(result.stdout, "wrangler deployments status").id;
}

export function selectUploadedVersion(
	versions: WorkerVersionSummary[],
	tag: string,
): WorkerVersionSummary {
	const matches = versions
		.filter((version) => version.annotations?.["workers/tag"] === tag)
		.sort((left, right) =>
			String(right.metadata?.created_on ?? "").localeCompare(
				String(left.metadata?.created_on ?? ""),
			),
		);
	if (matches.length === 0) {
		return fail(`No uploaded Worker version has tag ${tag}.`);
	}
	return matches[0];
}

export function uploadStagingWorkerVersion(options: {
	appName: string;
	config?: string;
	cwd: string;
	environment?: string;
	variables: Record<string, string>;
	workerName: string;
}): UploadedWorkerVersion {
	const sourceSha = resolveGitSha();
	const tag = `git-${sourceSha}`;
	const deploymentBefore = readCurrentDeploymentId(options.cwd, options.workerName);
	const args = ["versions", "upload"];
	if (options.config) {
		args.push("--config", options.config);
	}
	args.push("--env", options.environment ?? "staging");
	args.push("--tag", tag, "--message", `MUC-WIKI/campus-agent@${sourceSha} (${options.appName})`);
	for (const [name, value] of Object.entries(options.variables).sort(([left], [right]) =>
		left.localeCompare(right),
	)) {
		args.push("--var", `${name}:${value}`);
	}

	const upload = runWranglerCommand(args, { cwd: options.cwd, stdio: "inherit" });
	if (upload.status !== 0) {
		return fail(`Unable to upload a Worker version for ${options.workerName}.`);
	}

	const list = runWranglerCommand(["versions", "list", "--name", options.workerName, "--json"], {
		cwd: options.cwd,
		stdio: "pipe",
	});
	if (list.status !== 0) {
		return fail(`Unable to resolve the uploaded version for ${options.workerName}.`);
	}
	const version = selectUploadedVersion(
		parseJsonOutput<WorkerVersionSummary[]>(list.stdout, "wrangler versions list"),
		tag,
	);
	if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(version.id)) {
		return fail(`Uploaded Worker version for ${options.workerName} has an invalid id.`);
	}

	const deploymentAfter = readCurrentDeploymentId(options.cwd, options.workerName);
	if (deploymentAfter !== deploymentBefore) {
		return fail(
			`Uploading ${options.workerName} changed deployment ${deploymentBefore} to ${deploymentAfter}.`,
		);
	}

	const result = {
		workerName: options.workerName,
		versionId: version.id,
		sourceSha,
	};
	// biome-ignore lint/suspicious/noUndeclaredEnvVars: this direct release command is not a Turbo task.
	const outputPath = process.env.WORKER_VERSION_OUTPUT?.trim();
	if (outputPath) {
		writeFileSync(resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
	}
	return result;
}
