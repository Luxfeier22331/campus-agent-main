import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

interface Step {
	name: string;
	started_at: string;
	completed_at: string;
	conclusion: string | null;
}
interface Job extends Step {
	steps: Step[];
}
export interface Run {
	id: number;
	run_attempt: number;
	head_sha: string;
	head_branch: string;
	created_at: string;
	run_started_at: string;
	updated_at: string;
	conclusion: string | null;
	html_url: string;
}

const duration = (start: string, end: string) => {
	const result = Date.parse(end) - Date.parse(start);
	return Number.isFinite(result) && result >= 0 ? result : null;
};
const timestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/;

interface Location {
	job: string | null;
	step: string | null;
}
interface Hook extends Location {
	name: string;
	finishedAt: string;
	durationMs: number;
	outcome: string;
	source: string;
}
interface PnpmInstall extends Location {
	batch?: string;
	image: string | null;
	operation: string | null;
	name: string | null;
	resolved: number;
	reused: number;
	downloaded: number;
	added: number;
	done: boolean;
}

function mergeHooks(observations: Hook[]): Hook[] {
	const traces = observations.filter((hook) => hook.source === "prek trace busy+idle");
	const merged = [...traces];
	for (const verbose of observations.filter((hook) => hook.source === "prek verbose")) {
		const trace = traces.find(
			(hook) =>
				hook.job === verbose.job &&
				hook.step === verbose.step &&
				hook.name === verbose.name &&
				hook.source === "prek trace busy+idle",
		);
		if (trace) {
			trace.outcome = verbose.outcome;
			trace.source = "prek trace + verbose";
		} else {
			merged.push(verbose);
		}
	}
	return merged.sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt));
}

export function parseEvidence(log: string) {
	const commands: Record<string, unknown>[] = [];
	let plan: Record<string, unknown> | undefined;
	let outcomes: Record<string, string> = {};
	const outcomesByJob: Record<string, Record<string, string>> = {};
	const batches: Array<Location & Record<string, unknown>> = [];
	const cacheRestores = new Map<
		string,
		Location & { state: string; matchedKey?: string; warnings: string[] }
	>();
	const bodies: Array<Location & { time: string }> = [];
	const hooks: Hook[] = [];
	const pnpmInstalls: PnpmInstall[] = [];
	const installs = new Map<string, PnpmInstall>();
	const scopes = new Map<
		string,
		{
			verboseHook?: { name: string; outcome: string };
			hookOutcome: string;
			batch?: string;
			image: string | null;
		}
	>();
	const cacheSignals: Record<string, string[]> = {
		nix: [],
		go: [],
		uv: [],
		turbo: [],
		buildkit: [],
	};
	for (const raw of log.split("\n")) {
		const line = stripVTControlCharacters(raw);
		const time = line.match(timestamp)?.[0];
		const columns = line.split("\t");
		const location: Location =
			columns.length >= 3 ? { job: columns[0], step: columns[1] } : { job: null, step: null };
		const hostInstall =
			location.step === "Install validation dependencies" ||
			location.step === "Install affected workspaces";
		const imageEvidence =
			location.step === "Run affected Node and image evidence" ||
			location.step === "Run image evidence";
		const scopeKey = JSON.stringify(location);
		let scope = scopes.get(scopeKey);
		if (!scope) {
			scope = { hookOutcome: "unknown", image: null };
			scopes.set(scopeKey, scope);
		}
		// Ignore echoed shell source; only parse actual command output.
		const payload = line.replace(/^.*?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s*/, "");
		if (location.step === "Restore Go and lint caches") {
			const restore = cacheRestores.get(scopeKey) ?? {
				...location,
				state: "unknown",
				warnings: [],
			};
			if (/Failed to restore|Cache restore failed/iu.test(payload)) {
				restore.state = "restore-error";
				restore.warnings.push(payload);
			} else if (
				restore.state !== "restore-error" &&
				/Cache not found for input keys/u.test(payload)
			) {
				restore.state = "miss";
			} else if (/Cache restored from key:/u.test(payload)) {
				restore.matchedKey = payload.split("Cache restored from key:")[1].trim();
				restore.state = "restored";
			}
			cacheRestores.set(scopeKey, restore);
		}
		if (imageEvidence && payload.startsWith("[release-batch] ")) {
			try {
				const entry = JSON.parse(payload.slice("[release-batch] ".length));
				if (typeof entry.batch === "string") {
					batches.push({ ...location, ...entry });
					scope.batch = entry.state === "start" ? entry.batch : undefined;
					scope.image = null;
				}
			} catch {
				/* Interrupted batch record. */
			}
		}
		if (
			location.step === "Check execution-control native code" &&
			payload.startsWith("GO_CACHE ")
		) {
			cacheSignals.go.push(payload);
			const restore = [...cacheRestores.values()].find((entry) => entry.job === location.job);
			if (restore && restore.state !== "restore-error" && /matched=\S+/u.test(payload)) {
				restore.state = /exact_hit=true\b/u.test(payload) ? "exact-hit" : "prefix-hit";
			}
		}
		const result = payload.match(/\.{3,}(Passed|Failed|Skipped)\s*$/);
		if (result) {
			scope.hookOutcome =
				{ Passed: "success", Failed: "failure", Skipped: "skipped" }[result[1]] ?? "unknown";
		}
		const heading = payload.match(/^[- ]+hook id: (\S+)/);
		if (heading) {
			scope.verboseHook = { name: heading[1], outcome: scope.hookOutcome };
			scope.hookOutcome = "unknown";
		}
		const verbose = payload.match(/^[- ]+duration: ([\d.]+)(ms|s)$/);
		if (verbose && scope.verboseHook && time) {
			const ms = Number(verbose[1]) * (verbose[2] === "s" ? 1000 : 1);
			if (Number.isFinite(ms)) {
				hooks.push({
					...location,
					name: scope.verboseHook.name,
					finishedAt: time,
					durationMs: ms,
					outcome: scope.verboseHook.outcome,
					source: "prek verbose",
				});
			}
			scope.verboseHook = undefined;
		}
		if (payload === "CI_BODY_STARTED" && time) {
			bodies.push({ ...location, time });
		}
		for (const marker of ["CI_EVIDENCE ", "CI_PLAN ", "CI_OUTCOMES "]) {
			if (!payload.startsWith(marker)) {
				continue;
			}
			try {
				const value = JSON.parse(payload.slice(marker.length));
				if (!value || typeof value !== "object" || Array.isArray(value)) {
					continue;
				}
				if (marker === "CI_EVIDENCE ") {
					commands.push(value);
				}
				if (marker === "CI_PLAN ") {
					plan = value;
				}
				if (marker === "CI_OUTCOMES ") {
					outcomes = { ...outcomes, ...value };
					outcomesByJob[location.job ?? "unknown"] = value;
				}
			} catch {
				// A cancelled process may leave a partial final log line.
			}
		}
		const hook = payload.match(
			/INFO run\{hook_id=(\S+) language=\S+\}: close time.busy=(\S+) time.idle=(\S+)/,
		);
		if (hook && time) {
			const milliseconds = (value: string) => {
				const part = value.match(/^([\d.]+)(ns|µs|us|ms|s)$/);
				if (!part) {
					return Number.NaN;
				}
				return (
					Number(part[1]) * ({ ns: 0.000001, µs: 0.001, us: 0.001, ms: 1, s: 1000 }[part[2]] ?? 1)
				);
			};
			const ms = milliseconds(hook[2]) + milliseconds(hook[3]);
			if (Number.isFinite(ms)) {
				hooks.push({
					...location,
					name: hook[1],
					finishedAt: time,
					durationMs: ms,
					outcome: "unknown",
					source: "prek trace busy+idle",
				});
			}
		}
		// Preserve facts emitted by the tools, not an invented overall hit ratio.
		if (/copying path .* from 'https?:/.test(payload)) {
			cacheSignals.nix.push(payload);
		}
		const imageStart = payload.match(/^\[release-image\] image=(\S+) stage=build state=start/);
		if (imageEvidence && imageStart) {
			scope.image = imageStart[1];
		}
		let progress = payload;
		let operation: string | null = null;
		let operationName: string | null = null;
		let operationTarget: string | null = scope.image;
		if (payload.startsWith("[buildkit-pnpm] ")) {
			try {
				const entry = JSON.parse(payload.slice("[buildkit-pnpm] ".length));
				if (typeof entry.operation === "string" && typeof entry.progress === "string") {
					operation = entry.operation;
					operationTarget = typeof entry.target === "string" ? entry.target : scope.image;
					operationName = typeof entry.name === "string" ? entry.name : null;
					progress = entry.progress;
				}
			} catch {
				/* Interrupted log line; leave the last complete observation. */
			}
		} else {
			const buildkit = payload.match(/^(#\d+) [\d.]+ (Progress:.*)$/);
			if (buildkit) {
				operation = buildkit[1];
				progress = buildkit[2];
			}
		}
		const packages = progress.match(
			/^Progress: resolved (\d+), reused (\d+), downloaded (\d+), added (\d+)(, done)?\s*$/,
		);
		if (
			packages &&
			((operation === null && hostInstall) ||
				(operation !== null && imageEvidence && (scope.image || scope.batch)))
		) {
			const next: PnpmInstall = {
				...location,
				image: operationTarget,
				...(scope.batch ? { batch: scope.batch } : {}),
				operation,
				name: operationName,
				resolved: Number(packages[1]),
				reused: Number(packages[2]),
				downloaded: Number(packages[3]),
				added: Number(packages[4]),
				done: Boolean(packages[5]),
			};
			const key = JSON.stringify([scopeKey, scope.batch, operationTarget, operation]);
			const previous = installs.get(key);
			if (previous && JSON.stringify(previous) === JSON.stringify(next)) {
				// BuildKit can repeat the final progress record for the same operation.
			} else if (!previous || previous.done || next.resolved < previous.resolved) {
				pnpmInstalls.push(next);
				installs.set(key, next);
			} else {
				Object.assign(previous, next);
			}
		}
		if (/^\[release-image\] .*stage=build state=(?:complete|failed)/.test(payload)) {
			scope.image = null;
		}
		if (/^(Audited|Prepared|Installed) \d+ packages? in /.test(payload)) {
			cacheSignals.uv.push(payload);
		}
		if (/Cached:\s+\d+ cached, \d+ total/.test(payload)) {
			cacheSignals.turbo.push(payload);
		}
		if (
			imageEvidence &&
			(scope.image || scope.batch) &&
			/^(?:#\d+ CACHED|\[buildkit\] state=cached )/u.test(payload)
		) {
			cacheSignals.buildkit.push(payload);
		}
	}
	return {
		commands,
		plan,
		outcomes,
		outcomesByJob,
		batches,
		cacheRestores: [...cacheRestores.values()],
		bodies,
		hooks: mergeHooks(hooks),
		pnpmInstalls,
		cacheSignals,
	};
}

const outcomeKeys: Record<string, string> = {
	"Run affected Node evidence": "affected-node",
	"Generate pull request validation plan": "plan",
	"Install static-check dependencies": "install-static-dependencies",
	"Lint repository": "repository-lint",
	"Check repository documentation": "repository-docs",
	"Test repository scripts": "repository-test",
	"Check repository": "repository-check",
	"Run affected Node and image evidence": "affected-node-and-images",
	"Run container build contract evidence": "container-build",
	"Check execution-control native code": "execution-control-native",
	"Install affected workspaces": "install-affected",
	"Login for image cache reads": "image-cache-login",
	"Check executable contracts": "contracts",
	"Lint GitHub Actions": "github-actions",
	"Scan authored commits for secrets": "secrets",
};

export function buildReport(run: Run, jobs: Job[], log: string, recent: Run[]) {
	const evidence = parseEvidence(log);
	const stages = jobs.flatMap((job) =>
		job.steps.map((step) => {
			const wallMs = duration(step.started_at, step.completed_at);
			const body = evidence.bodies.find(
				(entry) => entry.job === job.name && entry.step === step.name,
			);
			const outcome =
				evidence.outcomesByJob[job.name]?.[outcomeKeys[step.name]] ?? step.conclusion ?? "unknown";
			return {
				...step,
				job: job.name,
				outcome,
				durationMs: wallMs,
				setupMs: body ? duration(step.started_at, body.time) : null,
				failureClass:
					outcome === "failure"
						? step.name.toLowerCase().includes("lint")
							? "lint"
							: step.name.toLowerCase().includes("test")
								? "test"
								: step.name.toLowerCase().includes("install")
									? "dependency"
									: "validation"
						: null,
				skipReason:
					outcome === "skipped"
						? step.name.startsWith("Check repository documentation") ||
							step.name === "Test repository scripts"
							? "Repository prerequisite did not succeed or run was cancelled"
							: "Not selected, prerequisite failed, or run cancelled; see plan and prior outcomes"
						: null,
			};
		}),
	);
	const trend = recent
		.filter((item) => item.conclusion === "success" || item.conclusion === "failure")
		.slice(0, 5)
		.map((item) => ({
			runId: item.id,
			sha: item.head_sha,
			status: item.conclusion,
			durationMs: duration(item.created_at, item.updated_at),
		}));
	const newerRun =
		run.conclusion === "cancelled"
			? recent.find((item) => item.id > run.id && item.head_branch === run.head_branch)
			: undefined;
	return {
		runId: run.id,
		attempt: run.run_attempt,
		sha: run.head_sha,
		status: run.conclusion,
		url: run.html_url,
		queueMs: jobs.length > 0 ? duration(run.created_at, jobs[0].started_at) : null,
		cancellationReason: run.conclusion === "cancelled" ? "unknown" : null,
		newerRunId: newerRun?.id ?? null,
		stages,
		...evidence,
		trend,
		notes: [
			"setupMs measures step start to shell body, including Nix startup; not pure Nix evaluation time.",
			"GitHub API timestamps have second precision. API-derived durations are displayed as approximate whole seconds (rounded down); raw milliseconds are preserved in JSON. Subsecond setup/step differences can reflect timestamp precision.",
			"A newer run does not prove why a run was cancelled.",
			"Missing cache signals mean unknown; uv audit/install output is not a cache hit rate.",
			"A started command without a completion is unfinished; abrupt cancellation cannot guarantee a final event.",
		],
	};
}

export function renderReport(report: ReturnType<typeof buildReport>): string {
	const cell = (value: unknown) =>
		String(value ?? "unknown")
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll("|", "\\|")
			.replaceAll("\n", " ");
	const seconds = (value: number | null | undefined) =>
		value == null ? "unknown" : `${(value / 1000).toFixed(2)}s`;
	const approximateSeconds = (value: number | null | undefined) => {
		if (value == null) {
			return "unknown";
		}
		return value < 1000 ? "&lt;1s" : `~${Math.floor(value / 1000)}s`;
	};
	return [
		`## repo-checks — run ${report.runId}, attempt ${report.attempt}`,
		`Source: ${cell(report.sha)}; result: ${cell(report.status)}; runner wait: ${approximateSeconds(report.queueMs)}.`,
		report.plan
			? `Plan: ${cell(JSON.stringify(report.plan))}`
			: "Plan: unavailable (run predates instrumentation or logs were unavailable).",
		"",
		"| Step | Actual outcome | Wall time | Before shell body |",
		"| --- | --- | ---: | ---: |",
		...report.stages.map(
			(step) =>
				`| ${cell(step.name)} | ${cell(step.outcome)} | ${approximateSeconds(step.durationMs)} | ${approximateSeconds(step.setupMs)} |`,
		),
		"",
		"### Completed lint hooks",
		"",
		"| Hook | Outcome | Execution duration | Source |",
		"| --- | --- | ---: | --- |",
		...report.hooks.map(
			(hook) =>
				`| ${cell(hook.name)} | ${cell(hook.outcome)} | ${seconds(hook.durationMs)} | ${cell(hook.source)} |`,
		),
		"",
		"### Profile and command events",
		"",
		"| Profile / command | Status | Duration | Exit |",
		"| --- | --- | ---: | --- |",
		...report.commands.map(
			(event) =>
				`| ${cell(event.profile)} / ${cell(Array.isArray(event.command) ? event.command.join(" ") : "profile")} | ${cell(event.status)} | ${seconds(typeof event.durationMs === "number" ? event.durationMs : null)} | ${cell(event.exitCode)} |`,
		),
		"",
		"### Cache signals",
		"",
		...report.cacheRestores.map(
			(entry) =>
				`- Go restore (${cell(entry.job)}): ${cell(entry.state)}; ${cell(entry.matchedKey ?? "-")}${entry.warnings.length > 0 ? ` — ${cell(entry.warnings.join("; "))}` : ""}`,
		),
		...report.batches
			.filter((entry) => entry.state !== "start")
			.map(
				(entry) =>
					`- Image batch ${cell(entry.batch)}: ${cell(entry.state)}, ${seconds(typeof entry.durationMs === "number" ? entry.durationMs : null)}; cache export=${cell(entry.cacheExport)}`,
			),
		...Object.entries(report.cacheSignals).map(
			([tool, signals]) =>
				`- ${tool}: ${signals.length > 0 ? signals.slice(-5).map(cell).join("; ") : "unknown (no reliable signal)"}`,
		),
		"",
		"### pnpm installs",
		"",
		"| Job / step | Image / operation | Resolved | Reused | Downloaded | Added | Complete |",
		"| --- | --- | ---: | ---: | ---: | ---: | --- |",
		...report.pnpmInstalls.map(
			(install) =>
				`| ${cell(install.job)} / ${cell(install.step)} | ${install.image || install.operation ? `${cell(install.image)} / ${cell(install.name ?? install.operation)}` : "host"} | ${install.resolved} | ${install.reused} | ${install.downloaded} | ${install.added} | ${install.done} |`,
		),
		"",
		"### Recent completed runs (workflow wall time, including setup)",
		"",
		"| Run | Result | Duration |",
		"| --- | --- | ---: |",
		...report.trend.map(
			(item) => `| ${item.runId} | ${cell(item.status)} | ${approximateSeconds(item.durationMs)} |`,
		),
		"",
		...report.notes.map((note) => `- ${note}`),
		`- Cancellation reason: ${cell(report.cancellationReason)}; newer same-branch run: ${cell(report.newerRunId)}.`,
		"",
	].join("\n");
}

async function main() {
	const repository = process.env.GITHUB_REPOSITORY;
	const runId = process.env.REPORT_RUN_ID;
	if (!(repository && /^[\w.-]+\/[\w.-]+$/.test(repository) && runId && /^\d+$/.test(runId))) {
		throw new Error("Expected GITHUB_REPOSITORY and numeric REPORT_RUN_ID");
	}
	const api = (endpoint: string) =>
		JSON.parse(
			execFileSync("gh", ["api", endpoint], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }),
		);
	const run = api(`repos/${repository}/actions/runs/${runId}`) as Run;
	const jobs = api(
		`repos/${repository}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`,
	).jobs as Job[];
	let log = "";
	let logError: string | undefined;
	try {
		log = execFileSync(
			"gh",
			["run", "view", runId, "--repo", repository, "--attempt", String(run.run_attempt), "--log"],
			{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
		);
	} catch {
		logError = "Run logs unavailable; hook, command and cache observations are incomplete.";
	}
	const recent = api(`repos/${repository}/actions/workflows/pr.yml/runs?per_page=20`)
		.workflow_runs as Run[];
	const report = buildReport(run, jobs, log, recent);
	if (logError) {
		report.notes.push(logError);
	}
	writeFileSync("ci-timing-report.json", `${JSON.stringify(report, null, 2)}\n`);
	const markdown = renderReport(report);
	process.stdout.write(markdown);
	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
