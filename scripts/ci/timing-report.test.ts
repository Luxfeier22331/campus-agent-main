import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildReport, parseEvidence, type Run, renderReport } from "./timing-report.mts";

const run: Run = {
	id: 100,
	run_attempt: 1,
	head_sha: "a".repeat(40),
	head_branch: "test-ci",
	created_at: "2026-09-09T10:00:00Z",
	run_started_at: "2026-09-09T10:00:01Z",
	updated_at: "2026-09-09T10:01:00Z",
	conclusion: "success",
	html_url: "https://github.com/example/repo/actions/runs/100",
};
const line = (time: string, message: string) =>
	`repo-checks\tUNKNOWN STEP\t2026-09-09T10:${time}Z ${message}\n`;

test("report CLI runs with only Node and gh for success, failure and cancelled logs", async (t) => {
	for (const conclusion of ["success", "failure", "cancelled", "unavailable"]) {
		await t.test(conclusion, () => {
			const directory = mkdtempSync(path.join(tmpdir(), "timing-report-cli-"));
			try {
				const status = conclusion === "unavailable" ? "cancelled" : conclusion;
				const log =
					line("00:02", 'CI_PLAN {"validationProfiles":["execution-control-native"]}') +
					line("00:04", `CI_EVIDENCE {"profile":"go","status":"${status}"}`);
				writeFileSync(
					path.join(directory, "fixture.json"),
					JSON.stringify({
						run: { ...run, conclusion: status },
						jobs: [],
						log,
						missing: conclusion === "unavailable",
						recent: [{ ...run, id: 101 }, run],
					}),
				);
				writeFileSync(
					path.join(directory, "gh"),
					`#!${process.execPath}
const fs = require("node:fs");
const fixture = JSON.parse(fs.readFileSync("fixture.json", "utf8"));
const args = process.argv.slice(2);
fs.appendFileSync("calls.jsonl", JSON.stringify(args) + "\\n");
if (args[0] === "run") {
  if (fixture.missing) process.exit(1);
  process.stdout.write(fixture.log);
} else if (args[1].endsWith("/jobs?per_page=100")) {
  process.stdout.write(JSON.stringify({ jobs: fixture.jobs }));
} else if (args[1].endsWith("/runs?per_page=20")) {
  process.stdout.write(JSON.stringify({ workflow_runs: fixture.recent }));
} else if (args[1].endsWith("/runs/100")) {
  process.stdout.write(JSON.stringify(fixture.run));
} else process.exit(2);
`,
					{ mode: 0o755 },
				);
				execFileSync(process.execPath, [path.join(import.meta.dirname, "timing-report.mts")], {
					cwd: directory,
					env: {
						PATH: directory,
						GITHUB_REPOSITORY: "example/repo",
						REPORT_RUN_ID: "100",
						GITHUB_STEP_SUMMARY: path.join(directory, "summary.md"),
					},
				});
				const report = JSON.parse(
					readFileSync(path.join(directory, "ci-timing-report.json"), "utf8"),
				);
				assert.equal(report.status, status);
				assert.equal(report.commands.length, conclusion === "unavailable" ? 0 : 1);
				assert.equal(report.newerRunId, status === "cancelled" ? 101 : null);
				assert.match(readFileSync(path.join(directory, "summary.md"), "utf8"), /repo-checks/u);
				if (conclusion === "unavailable") {
					assert(report.notes.some((note: string) => note.includes("Run logs unavailable")));
				}
				const calls = readFileSync(path.join(directory, "calls.jsonl"), "utf8")
					.trim()
					.split("\n")
					.map((value) => JSON.parse(value));
				assert.deepEqual(calls, [
					["api", "repos/example/repo/actions/runs/100"],
					["api", "repos/example/repo/actions/runs/100/attempts/1/jobs?per_page=100"],
					["run", "view", "100", "--repo", "example/repo", "--attempt", "1", "--log"],
					["api", "repos/example/repo/actions/workflows/pr.yml/runs?per_page=20"],
				]);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		});
	}
});

test("separates environment startup from body and preserves actual continue-on-error outcome", () => {
	const log =
		line("00:07", "CI_BODY_STARTED") + line("00:09", 'CI_OUTCOMES {"repository-lint":"failure"}');
	const report = buildReport(
		run,
		[
			{
				name: "repo-checks",
				started_at: "2026-09-09T10:00:02Z",
				completed_at: run.updated_at,
				conclusion: "failure",
				steps: [
					{
						name: "Lint repository",
						started_at: "2026-09-09T10:00:03Z",
						completed_at: "2026-09-09T10:00:10Z",
						conclusion: "success",
					},
				],
			},
		],
		log,
		[run],
	);
	assert.equal(report.queueMs, 2000);
	assert.equal(report.stages[0].setupMs, 4000);
	assert.equal(report.stages[0].durationMs, 7000);
	assert.equal(report.stages[0].outcome, "failure");
	assert.equal(report.stages[0].failureClass, "lint");
});

test("reads native prek timing and tool cache facts without inventing a cache miss", () => {
	const parsed = parseEvidence(
		line(
			"00:05",
			"2026-09-09T10:00:05Z INFO run{hook_id=check-json language=system}: close time.busy=124ms time.idle=546µs",
		) +
			line("00:06", "Progress: resolved 20, reused 18, downloaded 2, added 20") +
			line("00:07", "Audited 12 packages in 4ms"),
	);
	assert.equal(parsed.hooks[0].durationMs, 124.546);
	assert.equal(parsed.hooks[0].name, "check-json");
	assert.equal(parsed.cacheSignals.pnpm.length, 1);
	assert.deepEqual(parsed.cacheSignals.nix, []);
	assert.match(parsed.cacheSignals.uv[0], /Audited/u);
});

test("reads verbose hook results from the result heading without assuming missing results succeeded", () => {
	const parsed = parseEvidence(
		line(
			"00:01",
			"check json...............................................................Passed",
		) +
			line("00:01", "- hook id: check-json") +
			line("00:01", "- duration: 0.16s") +
			line(
				"00:02",
				"Ruff lint................................................................Failed",
			) +
			line("00:02", "- hook id: ruff-check") +
			line("00:02", "- duration: 0.20s") +
			line("00:02", "- exit code: 2") +
			line("00:03", "- hook id: incomplete-log") +
			line("00:03", "- duration: 0.10s"),
	);
	assert.deepEqual(
		parsed.hooks.map(({ name, outcome, durationMs }) => [name, outcome, durationMs]),
		[
			["check-json", "success", 160],
			["ruff-check", "failure", 200],
			["incomplete-log", "unknown", 100],
		],
	);
});

test("cancelled runs keep completed events and distinguish unfinished commands from known failures", () => {
	const log =
		line(
			"00:04",
			'CI_EVIDENCE {"kind":"command","profile":"go","command":["pnpm","native:format"],"status":"success","durationMs":20,"exitCode":0}',
		) +
		line(
			"00:05",
			'CI_EVIDENCE {"kind":"command","profile":"go","command":["pnpm","native:lint"],"status":"running"}',
		) +
		line("00:06", 'CI_EVIDENCE {"kind":');
	const report = buildReport({ ...run, conclusion: "cancelled" }, [], log, [
		{ ...run, id: 101 },
		run,
	]);
	assert.equal(report.commands.length, 2);
	assert.equal(report.commands[0].status, "success");
	assert.equal(report.commands[1].status, "running");
	assert.equal(report.cancellationReason, "unknown");
	assert.equal(report.newerRunId, 101);
	assert.equal(report.queueMs, null);
});

test("empty or old logs leave missing data unknown and the report escapes log content", () => {
	const report = buildReport(
		run,
		[],
		line(
			"00:00",
			'CI_EVIDENCE {"profile":"<script>|x","command":["echo","<img>"],"status":"failure"}',
		),
		[],
	);
	const markdown = renderReport(report);
	assert.match(markdown, /unknown \(no reliable signal\)/u);
	assert.doesNotMatch(markdown, /<script>|<img>/u);
	assert.match(markdown, /&lt;script&gt;/u);
	assert.equal(report.plan, undefined);
});
