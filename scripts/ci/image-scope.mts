import { imageTargetsForScope, readImageWorkspaces } from "../release/image-targets.mts";
import { type CommandRunner, parseChangedFiles, requireSuccess, run } from "./scope.mts";

// Successful PR merges are siblings, so compare their trees directly, not their merge-base.
export function imageScopeBetween(
	base: string,
	head: string,
	root: string,
	runner: CommandRunner = run,
) {
	if (![base, head].every((sha) => /^[a-f0-9]{40}$/u.test(sha))) {
		throw new Error("Image revisions must be full commit SHAs");
	}
	const args = ["diff", "--name-status", "-z", "--diff-filter=ACDMRT", base, head];
	const changedFiles = parseChangedFiles(
		requireSuccess("git", args, runner("git", args, { cwd: root, env: process.env })).stdout ?? "",
	);
	const workspaces = [
		...readImageWorkspaces(root, base, runner),
		...readImageWorkspaces(root, head, runner),
	];
	const imageFiles =
		changedFiles.includes("package.json") && rootScriptsOnlyChanged(base, head, root, runner)
			? changedFiles.filter((file) => file !== "package.json")
			: changedFiles;
	return {
		base,
		head,
		changedFiles,
		images: imageTargetsForScope({ changedFiles: imageFiles }, workspaces),
	};
}

// Image builds install with --ignore-scripts and run only workspace scripts, so root scripts are
// not a production input; every other root manifest field still selects the Node images.
function rootScriptsOnlyChanged(
	base: string,
	head: string,
	root: string,
	runner: CommandRunner,
): boolean {
	const manifests = [base, head].map((revision) => {
		const result = runner("git", ["show", `${revision}:package.json`], {
			cwd: root,
			env: process.env,
		});
		if (result.status !== 0) {
			// An added or deleted root manifest is a real Node build input change.
			return revision;
		}
		const { scripts: _scripts, ...manifest } = JSON.parse(result.stdout ?? "");
		return JSON.stringify(manifest);
	});
	return manifests[0] === manifests[1];
}

interface WorkflowRun {
	id: number;
	status: string;
	conclusion: string | null;
	pull_requests: Array<{ number: number }>;
	referenced_workflows?: Array<{ path: string; sha: string }>;
}
export interface ImageBaseline {
	sha: string;
	runId: number;
}

export function successfulImageBaseline(
	input: { repository: string; pullRequest: number; runId: number; branch: string; root: string },
	runner: CommandRunner = run,
): ImageBaseline | undefined {
	const options = { cwd: input.root, env: process.env };
	const api = (endpoint: string, paginate = false) => {
		const args = ["api", endpoint, ...(paginate ? ["--paginate", "--slurp"] : [])];
		return JSON.parse(requireSuccess("gh", args, runner("gh", args, options)).stdout ?? "null");
	};
	try {
		const pages: Array<{ workflow_runs: WorkflowRun[] }> = api(
			`repos/${input.repository}/actions/workflows/pr.yml/runs?event=pull_request&status=success&branch=${encodeURIComponent(input.branch)}&per_page=100`,
			true,
		);
		const candidates = pages
			.flatMap((page) => page.workflow_runs)
			.filter(
				(candidate) =>
					candidate.id < input.runId &&
					candidate.status === "completed" &&
					candidate.conclusion === "success" &&
					candidate.pull_requests.some((pr) => pr.number === input.pullRequest),
			)
			.sort((left, right) => right.id - left.id);
		for (const candidate of candidates) {
			const detail: WorkflowRun = api(`repos/${input.repository}/actions/runs/${candidate.id}`);
			const reference = detail.referenced_workflows?.find((workflow) =>
				workflow.path.startsWith(`${input.repository}/.github/workflows/pr-image-evidence.yml@`),
			);
			if (!(reference && /^[a-f0-9]{40}$/u.test(reference.sha))) {
				continue;
			}
			const jobPages: Array<{ jobs: Array<{ name: string; conclusion: string | null }> }> = api(
				`repos/${input.repository}/actions/runs/${candidate.id}/jobs?per_page=100`,
				true,
			);
			if (
				!jobPages
					.flatMap((page) => page.jobs)
					.some(
						(job) =>
							["image-evidence-trusted / build", "image-evidence-readonly / build"].includes(
								job.name,
							) && job.conclusion === "success",
					)
			) {
				continue;
			}
			let available = runner("git", ["cat-file", "-e", `${reference.sha}^{commit}`], options);
			if (available.status !== 0) {
				const fetched = runner("git", ["fetch", "--no-tags", "origin", reference.sha], options);
				if (fetched.status !== 0) {
					continue;
				}
				available = runner("git", ["cat-file", "-e", `${reference.sha}^{commit}`], options);
			}
			if (available.status === 0) {
				return { sha: reference.sha, runId: candidate.id };
			}
		}
	} catch {
		// Without a usable successful baseline, the caller checks the full PR input diff.
		process.stderr.write("Image baseline unavailable; selecting images from the full PR diff.\n");
	}
	return undefined;
}
