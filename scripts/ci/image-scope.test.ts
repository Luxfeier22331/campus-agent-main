import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { imageScopeBetween, successfulImageBaseline } from "./image-scope.mts";
import { type CommandRunner, run } from "./scope.mts";
import { planValidation } from "./validation.mts";

test("compares sibling trees and retains removed production dependency edges", (t) => {
	const root = mkdtempSync(path.join(os.tmpdir(), "image-scope-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	const write = (file: string, body: string) => {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		writeFileSync(path.join(root, file), body);
	};
	git("init", "-q");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	write(
		"apps/ops-web/package.json",
		JSON.stringify({ name: "ops-web", dependencies: { shared: "workspace:*" } }),
	);
	write("packages/shared/package.json", JSON.stringify({ name: "shared" }));
	write("packages/shared/src/index.ts", "export const value = 1;");
	git("add", ".");
	git("commit", "-qm", "base");
	const base = git("rev-parse", "HEAD");
	write("apps/ops-web/src/index.ts", "export const app = 1;");
	git("add", ".");
	git("commit", "-qm", "previous merge tree");
	const previous = git("rev-parse", "HEAD");
	git("checkout", "-q", "--detach", base);
	write("apps/ops-web/src/index.ts", "export const app = 1;");
	write("apps/ops-web/src/index.test.ts", "test only");
	write("turbo.json", "{}");
	git("add", ".");
	git("commit", "-qm", "current merge tree");
	const current = git("rev-parse", "HEAD");
	assert.deepEqual(imageScopeBetween(previous, current, root).images, []);
	assert.deepEqual(imageScopeBetween(base, current, root).images, ["ops-web"]);
	const plan = planValidation(
		{ base, head: current, repositoryRoot: root, imageBaseline: { sha: previous, runId: 10 } },
		(command, args, options) =>
			command === "pnpm"
				? {
						status: 0,
						stdout: JSON.stringify({
							tasks: [{ package: "ops-web", task: "build", command: "vite build" }],
						}),
					}
				: run(command, args, options),
	);
	assert.equal(plan.base, base);
	assert.equal(plan.imageBase, previous);
	assert.deepEqual(plan.images, []);
	assert(plan.affectedPackages.includes("ops-web"));
	git("mv", "packages/shared/src/index.ts", "packages/shared/src/renamed.ts");
	git("commit", "-qm", "rename production source");
	const renamed = imageScopeBetween(current, git("rev-parse", "HEAD"), root);
	assert(renamed.changedFiles.includes("packages/shared/src/index.ts"));
	assert(renamed.changedFiles.includes("packages/shared/src/renamed.ts"));
	assert.deepEqual(renamed.images, ["ops-web"]);
	write("apps/ops-web/package.json", JSON.stringify({ name: "ops-web" }));
	rmSync(path.join(root, "packages/shared"), { recursive: true });
	git("add", "-A");
	git("commit", "-qm", "remove dependency");
	assert.deepEqual(imageScopeBetween(current, git("rev-parse", "HEAD"), root).images, ["ops-web"]);
});

test("baseline requires the same PR, successful workflow and successful image job", () => {
	const sha = "a".repeat(40);
	const queried: string[] = [];
	const runner: CommandRunner = (command, args) => {
		if (command === "git") {
			return { status: 0 };
		}
		const endpoint = args[1] ?? "";
		queried.push(endpoint);
		let body: unknown;
		if (endpoint.includes("/workflows/")) {
			body = [
				{
					workflow_runs: [
						{ id: 99, status: "completed", conclusion: "success", pull_requests: [{ number: 2 }] },
						{ id: 98, status: "completed", conclusion: "failure", pull_requests: [{ number: 1 }] },
						{
							id: 97,
							status: "completed",
							conclusion: "cancelled",
							pull_requests: [{ number: 1 }],
						},
						{ id: 96, status: "completed", conclusion: "success", pull_requests: [{ number: 1 }] },
						{ id: 95, status: "completed", conclusion: "success", pull_requests: [{ number: 1 }] },
						{ id: 100, status: "completed", conclusion: "success", pull_requests: [{ number: 1 }] },
					],
				},
			];
		} else if (endpoint.includes("/jobs?")) {
			body = [
				{
					jobs: [
						{
							name: "image-evidence-trusted / build",
							conclusion: endpoint.includes("/96/") ? "skipped" : "success",
						},
					],
				},
			];
		} else {
			body = {
				referenced_workflows: [
					{ path: "owner/repo/.github/workflows/pr-image-evidence.yml@refs/pull/1/merge", sha },
				],
			};
		}
		return { status: 0, stdout: JSON.stringify(body) };
	};
	assert.deepEqual(
		successfulImageBaseline(
			{ repository: "owner/repo", pullRequest: 1, runId: 100, branch: "fix/topic", root: "." },
			runner,
		),
		{ sha, runId: 95 },
	);
	assert(!queried.some((endpoint) => /runs\/(99|98|97|100)(\/|$)/u.test(endpoint)));
});

test("unavailable history or unfetchable merge commits use the full PR diff", () => {
	const input = {
		repository: "owner/repo",
		pullRequest: 1,
		runId: 100,
		branch: "topic",
		root: ".",
	};
	assert.equal(
		successfulImageBaseline(input, () => ({ status: 1 })),
		undefined,
	);
	const runner: CommandRunner = (command, args) => {
		if (command === "git") {
			return { status: 1 };
		}
		const endpoint = args[1] ?? "";
		const body = endpoint.includes("/workflows/")
			? [
					{
						workflow_runs: [
							{
								id: 90,
								status: "completed",
								conclusion: "success",
								pull_requests: [{ number: 1 }],
							},
						],
					},
				]
			: endpoint.includes("/jobs?")
				? [{ jobs: [{ name: "image-evidence-readonly / build", conclusion: "success" }] }]
				: {
						referenced_workflows: [
							{
								path: "owner/repo/.github/workflows/pr-image-evidence.yml@ref",
								sha: "b".repeat(40),
							},
						],
					};
		return { status: 0, stdout: JSON.stringify(body) };
	};
	assert.equal(successfulImageBaseline(input, runner), undefined);
});
