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
const line = (time: string, message: string, step = "Lint repository", job = "repo-checks") =>
	`${job}\t${step}\t2026-09-09T10:${time}Z ${message}\n`;

test("Go restore warnings remain errors even when the action succeeds", () => {
	const parsed = parseEvidence(
		line(
			"00:01",
			"##[warning]Failed to restore: tar failed with error: The process exited with code 2",
			"Restore Go and lint caches",
		) +
			line("00:02", "Cache not found for input keys: go-v2-key", "Restore Go and lint caches") +
			line(
				"00:03",
				"GO_CACHE action_outcome=success exact_hit= primary=go-v2-key matched=",
				"Check agent-control native code",
			),
	);
	assert.equal(parsed.cacheRestores[0].state, "restore-error");
	assert.equal(parsed.cacheRestores[0].warnings.length, 1);
	for (const exact of [true, false]) {
		const restored = parseEvidence(
			line("00:01", "Cache restored from key: go-v2-old", "Restore Go and lint caches") +
				line(
					"00:02",
					`GO_CACHE action_outcome=success exact_hit=${exact} primary=go-v2-key matched=go-v2-old`,
					"Check agent-control native code",
				),
		);
		assert.equal(restored.cacheRestores[0].state, exact ? "exact-hit" : "prefix-hit");
	}
});

test("outcomes remain scoped to their producing jobs", () => {
	const parsed = parseEvidence(
		line("00:01", 'CI_OUTCOMES {"repository-lint":"failure"}', "Summary", "validation") +
			line("00:02", 'CI_OUTCOMES {"repository-lint":"success"}', "Summary", "images"),
	);
	assert.equal(parsed.outcomesByJob.validation["repository-lint"], "failure");
	assert.equal(parsed.outcomesByJob.images["repository-lint"], "success");
});

test("report CLI runs with only Node and gh for success, failure and cancelled logs", async (t) => {
	for (const conclusion of ["success", "failure", "cancelled", "unavailable"]) {
		await t.test(conclusion, () => {
			const directory = mkdtempSync(path.join(tmpdir(), "timing-report-cli-"));
			try {
				const status = conclusion === "unavailable" ? "cancelled" : conclusion;
				const log =
					line("00:02", 'CI_PLAN {"validationProfiles":["agent-control-native"]}') +
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

test("Go cache observations distinguish prefix hits and misses without implying lint hit rates", () => {
	const signal = "GO_CACHE restore=success exact_hit=false primary=go-new matched=go-old";
	const parsed = parseEvidence(
		line("00:07", signal, "Check agent-control native code") +
			line("00:08", `printf '${signal}'`, "Check agent-control native code") +
			line("00:09", signal, "Test repository scripts"),
	);
	assert.deepEqual(parsed.cacheSignals.go, [signal]);
	assert.deepEqual(parseEvidence("").cacheSignals.go, []);
});

test("reads native prek timing and tool cache facts without inventing a cache miss", () => {
	const parsed = parseEvidence(
		line(
			"00:05",
			"2026-09-09T10:00:05Z INFO run{hook_id=check-json language=system}: close time.busy=124ms time.idle=546µs",
		) +
			line(
				"00:06",
				"Progress: resolved 20, reused 18, downloaded 2, added 20",
				"Install validation dependencies",
			) +
			line("00:07", "Audited 12 packages in 4ms"),
	);
	assert.equal(parsed.hooks[0].durationMs, 124.546);
	assert.equal(parsed.hooks[0].name, "check-json");
	assert.equal(parsed.pnpmInstalls.length, 1);
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

test("trace and verbose observations describe one execution while repeated hooks remain separate", () => {
	const trace = "INFO run{hook_id=biome language=system}: close time.busy=5.17s time.idle=30µs";
	const verbose =
		line("00:08", "Biome...........Passed") +
		line("00:08", "- hook id: biome") +
		line("00:08", "- duration: 5.17s");
	const parsed = parseEvidence(
		line("00:06", trace) +
			verbose +
			line("00:09", trace) +
			verbose +
			line("00:10", trace, "Other step"),
	);
	assert.equal(parsed.hooks.length, 3);
	assert.deepEqual(
		parsed.hooks.map((hook) => hook.outcome),
		["success", "success", "unknown"],
	);
	assert.equal(parsed.hooks[0].durationMs, 5170.03);
	assert.equal(parsed.hooks[0].finishedAt, "2026-09-09T10:00:06Z");
});

test("body markers belong to their named job and step even at the same second", () => {
	const report = buildReport(
		run,
		[
			{
				name: "repo-checks",
				started_at: run.created_at,
				completed_at: run.updated_at,
				conclusion: "success",
				steps: ["Build", "Cleanup"].map((name) => ({
					name,
					started_at: "2026-09-09T10:00:10Z",
					completed_at: "2026-09-09T10:00:10Z",
					conclusion: "success",
				})),
			},
		],
		line("00:10.300", "CI_BODY_STARTED", "Build") +
			line("00:10.100", "CI_BODY_STARTED", "Cleanup", "other-job"),
		[],
	);
	assert.equal(report.stages[0].setupMs, 300);
	assert.equal(report.stages[1].setupMs, null);
	assert.match(renderReport(report), /\| Build \| success \| &lt;1s \| &lt;1s \|/u);
	assert.match(renderReport(report), /\| Cleanup \| success \| &lt;1s \| unknown \|/u);
});

test("API-derived display uses whole seconds without clamping raw setup or direct measurements", () => {
	const report = buildReport(
		run,
		[
			{
				name: "repo-checks",
				started_at: "2026-09-09T10:00:02Z",
				completed_at: run.updated_at,
				conclusion: "success",
				steps: ["Precision", "Large discrepancy"].map((name) => ({
					name,
					started_at: "2026-09-09T10:00:10Z",
					completed_at: "2026-09-09T10:00:18Z",
					conclusion: "success",
				})),
			},
		],
		line("00:18.660", "CI_BODY_STARTED", "Precision") +
			line("00:20.660", "CI_BODY_STARTED", "Large discrepancy") +
			line(
				"00:21",
				"INFO run{hook_id=biome language=system}: close time.busy=124ms time.idle=0ms",
			) +
			line("00:22", 'CI_EVIDENCE {"profile":"container-build","status":"success","durationMs":74}'),
		[run],
	);
	const markdown = renderReport(report);
	assert.match(markdown, /\| Precision \| success \| ~8s \| ~8s \|/u);
	assert.match(markdown, /\| Large discrepancy \| success \| ~8s \| ~10s \|/u);
	assert.match(markdown, /runner wait: ~2s/u);
	assert.match(markdown, /\| 100 \| success \| ~60s \|/u);
	assert.match(markdown, /\| biome \| unknown \| 0\.12s \|/u);
	assert.match(markdown, /\| container-build \/ profile \| success \| 0\.07s \|/u);
	const json = JSON.parse(JSON.stringify(report));
	assert.equal(json.stages[0].durationMs, 8000);
	assert.equal(json.stages[0].setupMs, 8660);
	assert.equal(json.stages[1].setupMs, 10660);
	assert.equal(json.hooks[0].durationMs, 124);
	assert.equal(json.commands[0].durationMs, 74);
});

test("installation and BuildKit cache observations belong to real install and image steps", () => {
	const build = "Run affected Node and image evidence";
	const tests = "Test repository scripts";
	const progress = "Progress: resolved 2, reused 1, downloaded 1, added 2, done";
	const operation = `[buildkit-pnpm] ${JSON.stringify({ operation: "install", name: "RUN pnpm install", progress })}`;
	const start = "[release-image] image=ops-web stage=build state=start";
	const cached = '[buildkit] state=cached operation="RUN pnpm install"';
	const parsed = parseEvidence(
		line("00:01", progress, tests) +
			line("00:01", start, tests) +
			line("00:02", operation, tests) +
			line("00:02", cached, tests) +
			line("00:02", "#10 CACHED", tests) +
			line("00:03", progress, "Install validation dependencies") +
			line("00:03", progress, "Install affected workspaces") +
			line("00:04", operation, build) +
			line("00:04", cached, build) +
			line("00:05", start, build) +
			line("00:06", operation, build) +
			line("00:06", cached, build) +
			line("00:07", "[release-image] image=ops-web stage=build state=complete", build) +
			line("00:08", operation, build) +
			line("00:08", cached, build) +
			line("00:09", start.replace("ops-web", "status-web"), build) +
			line("00:10", `#10 1.00 ${progress}`, build) +
			line("00:10", "#10 CACHED", build) +
			line("00:11", "[release-image] image=status-web stage=build state=failed", build) +
			line("00:12", operation, build) +
			line("00:12", cached, build),
	);
	assert.deepEqual(
		parsed.pnpmInstalls.map(({ step, image, operation }) => ({ step, image, operation })),
		[
			{ step: "Install validation dependencies", image: null, operation: null },
			{ step: "Install affected workspaces", image: null, operation: null },
			{ step: build, image: "ops-web", operation: "install" },
			{ step: build, image: "status-web", operation: "#10" },
		],
	);
	assert.deepEqual(parsed.cacheSignals.buildkit, [cached, "#10 CACHED"]);
});

test("host installs and interleaved Docker operations retain separate final progress", () => {
	const progress = (resolved: number, done = true) =>
		`Progress: resolved ${resolved}, reused 2, downloaded ${resolved - 2}, added ${resolved}${done ? ", done" : ""}`;
	const build = "Run affected Node and image evidence";
	const parsed = parseEvidence(
		line("00:01", progress(250), "Install validation dependencies") +
			line("00:02", progress(853), "Install affected workspaces") +
			line("00:03", "[release-image] image=ops-web stage=build state=start", build) +
			line("00:04", `#19 1.00 ${progress(10, false)}`, build) +
			line("00:05", `#23 2.00 ${progress(20)}`, build) +
			line("00:06", `#19 3.00 ${progress(1103)}`, build) +
			line("00:06", `#19 3.00 ${progress(1103)}`, build) +
			line(
				"00:07",
				`[buildkit-pnpm] ${JSON.stringify({ operation: "compile", name: "RUN pnpm deploy", progress: progress(4) })}`,
				build,
			) +
			line(
				"00:08",
				`[buildkit-pnpm] ${JSON.stringify({ operation: "compile", name: "RUN pnpm deploy", progress: progress(5, false) })}`,
				build,
			),
	);
	assert.deepEqual(
		parsed.pnpmInstalls.map((install) => install.resolved),
		[250, 853, 1103, 20, 4, 5],
	);
	assert.equal(parsed.pnpmInstalls[2].operation, "#19");
	assert.equal(parsed.pnpmInstalls[2].image, "ops-web");
	assert.equal(parsed.pnpmInstalls[0].image, null);
	assert.equal(parsed.pnpmInstalls.at(-1)?.done, false);
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
