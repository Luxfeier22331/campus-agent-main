import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = "MUC-WIKI/campus-agent-gitops";
const requestId = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8" }).trim();
let artifactRef = process.env.WORKER_BUILD_INPUT_REF;
if (!artifactRef) {
	gh([
		"workflow",
		"run",
		"worker-build-input.yml",
		"--repo",
		repo,
		"--ref",
		"main",
		"-f",
		`source_sha=${process.env.GITHUB_SHA}`,
		"-f",
		`request_id=${requestId}`,
		"-f",
		`workers=${process.env.WORKERS}`,
	]);
	const deadline = Date.now() + 25 * 60_000;
	let run: { id: number; status: string; conclusion: string } | undefined;
	while (Date.now() < deadline) {
		const result = JSON.parse(
			gh([
				"api",
				`repos/${repo}/actions/workflows/worker-build-input.yml/runs?event=workflow_dispatch&per_page=100`,
			]),
		);
		run = result.workflow_runs.find(
			(item: any) => item.display_title === `worker-input-${requestId}`,
		);
		if (run?.status === "completed") {
			break;
		}
		await new Promise((done) => setTimeout(done, 10_000));
	}
	if (run?.conclusion !== "success") {
		throw new Error(`GitOps Worker input preparation did not succeed: ${run?.id ?? "not started"}`);
	}
	const directory = resolve("worker-build-input-result");
	mkdirSync(directory, { recursive: true });
	gh([
		"run",
		"download",
		String(run.id),
		"--repo",
		repo,
		"--name",
		`worker-input-${requestId}`,
		"--dir",
		directory,
	]);
	artifactRef = JSON.parse(readFileSync(resolve(directory, "input.json"), "utf8")).artifactRef;
}
if (
	!/^ghcr\.io\/muc-wiki\/campus-agent-gitops\/worker-input@sha256:[a-f0-9]{64}$/.test(
		artifactRef ?? "",
	)
) {
	throw new Error("Invalid Worker build input reference");
}
appendFileSync(process.env.GITHUB_ENV!, `WORKER_BUILD_INPUT_REF=${artifactRef}\n`);
