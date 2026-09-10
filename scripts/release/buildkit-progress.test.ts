import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseEvidence } from "../ci/timing-report.mts";
import { BuildkitProgress, parseBuildkit, renderBuildkit } from "./buildkit-progress.mts";
import { runCommand } from "./images.mts";

const time = (second: number) => `2026-09-10T00:00:${String(second).padStart(2, "0")}Z`;
const vertex = (value: object) => `${JSON.stringify({ vertexes: [value] })}\n`;
const command = (id: string, text: string) =>
	`${JSON.stringify({ logs: [{ vertex: id, stream: 1, data: Buffer.from(text).toString("base64") }] })}\n`;

test("real BuildKit samples retain installs, SBOM, exporter substeps and cache import", () => {
	for (const name of ["fixed-first", "cache-only-import"]) {
		const log = readFileSync(
			path.join(import.meta.dirname, `testdata/buildkit-${name}.jsonl`),
			"utf8",
		);
		const report = parseBuildkit(log);
		assert.equal(report.cacheExport, "success");
		assert.equal(report.incomplete, false);
		assert(report.operations.some((item) => item.category === "sbom"));
		assert(report.operations.some((item) => item.category === "image-push" && item.parentId));
		assert(report.operations.some((item) => item.category === "cache-export" && item.parentId));
		const install = report.operations.find((item) => item.category === "dependencies");
		assert(install);
		if (name === "cache-only-import") {
			assert.equal(install.state, "cached");
			assert.deepEqual(install.pnpm, []);
			assert.match(renderBuildkit(report), /not executed/u);
		} else {
			assert.equal(install.state, "complete");
			assert.equal(install.pnpm.at(-1)?.reused, 248);
		}
	}
});

test("chunked JSON, repeated starts and overlapping intervals are not overwritten or double-counted", () => {
	const log =
		vertex({ digest: "a", name: "RUN pnpm install", started: time(0) }) +
		vertex({ digest: "a", completed: time(4) }) +
		vertex({ digest: "a", started: time(2), completed: time(6) }) +
		vertex({ digest: "a", started: time(2), completed: time(6) }) +
		vertex({ digest: "a", started: time(8), completed: time(9) }) +
		vertex({ digest: "b", name: "other", started: time(0), completed: time(9) });
	const parser = new BuildkitProgress();
	for (let i = 0; i < log.length; i += 7) {
		parser.push(log.slice(i, i + 7));
	}
	const report = parser.finish();
	assert.equal(report.operations[0].durationMs, 7000);
	assert.equal(report.operations[0].intervals.length, 3);
	assert.equal(report.operations[1].durationMs, 9000);
	assert.equal(report.incomplete, false);
});

test("command progress keeps separate install sequences and decodes split log lines", () => {
	const output: string[] = [];
	const parser = new BuildkitProgress((text) => output.push(text));
	parser.push(vertex({ digest: "a", name: "RUN pnpm install", started: time(0) }));
	parser.push(command("a", "Progress: resolved 10, reused 8, down"));
	parser.push(command("a", "loaded 2, added 10, done\n"));
	parser.push(command("a", "Progress: resolved 10, reused 8, downloaded 2, added 10, done\n"));
	parser.push(command("a", "Progress: resolved 2, reused 1, downloaded 1, added 2\n"));
	parser.push(command("a", "Progress: resolved 5, reused 1, downloaded 4, added 5, done"));
	parser.push(vertex({ digest: "a", started: time(0), completed: time(5) }));
	const report = parser.finish();
	assert.equal(report.operations[0].pnpm.length, 2);
	assert.deepEqual(
		report.operations[0].pnpm.map((item) => item.downloaded),
		[2, 4],
	);
	assert(output.join("").includes("reused 8, downloaded 2"));
	assert.equal(report.operations[0].state, "complete");
});

test("streamed package lines retain operation identity through the timing report", () => {
	const output: string[] = [];
	const parser = new BuildkitProgress((text) => output.push(text));
	parser.push(vertex({ digest: "a", name: "RUN pnpm install" }));
	parser.push(vertex({ digest: "b", name: "RUN pnpm deploy" }));
	parser.push(command("a", "Preparing dependencies\nProgress: resolved 10, reused 8, down"));
	parser.push(command("b", "Progress: resolved 2, reused 1, downloaded 1, added 2, done\n"));
	parser.push(command("a", "loaded 2, added 10, done\n"));
	parser.push(command("a", "Progress: resolved 10, reused 8, downloaded 2, added 10, done\n"));
	parser.push(command("b", "Artifact complete"));
	parser.finish();
	assert(output.join("").includes("Preparing dependencies\n"));
	assert(output.join("").includes("Artifact complete\n"));
	const evidence = parseEvidence(
		`[release-image] image=ops-web stage=build state=start\n${output.join("")}`
			.split("\n")
			.map((line) => `repo-checks\tRun affected Node and image evidence\t${time(0)} ${line}`)
			.join("\n"),
	);
	assert.deepEqual(
		evidence.pnpmInstalls.map(({ operation, name, downloaded }) => ({
			operation,
			name,
			downloaded,
		})),
		[
			{ operation: "b", name: "RUN pnpm deploy", downloaded: 1 },
			{ operation: "a", name: "RUN pnpm install", downloaded: 2 },
		],
	);
});

test("cache failure stays a warning independently of a successful image export", () => {
	const report = parseBuildkit(
		vertex({ digest: "image", name: "exporting to image", started: time(0), completed: time(1) }) +
			vertex({
				digest: "cache",
				name: "exporting cache to registry",
				started: time(1),
				completed: time(2),
				error: "403 forbidden",
			}),
	);
	assert.equal(report.cacheExport, "warning");
	assert.equal(report.operations[0].state, "complete");
	assert.match(renderBuildkit(report), /403 forbidden/u);
	const ignored = parseBuildkit(
		`${vertex({ digest: "cache", name: "exporting cache to registry", started: time(0), completed: time(1) })}WARNING: failed to export cache: 403\n`,
	);
	assert.equal(ignored.cacheExport, "warning");
});

test("unknown records and interrupted output remain visible and incomplete", () => {
	const output: string[] = [];
	const parser = new BuildkitProgress((text) => output.push(text));
	parser.push(vertex({ digest: "a", name: "<unfamiliar>|operation", started: time(0) }));
	parser.push(vertex({ digest: "cache", name: "exporting cache to registry", started: time(1) }));
	parser.push('ERROR: connection closed\n{"newFormat":true}\n{"vertexes":');
	const report = parser.finish("SIGTERM");
	assert.equal(report.cacheExport, "unfinished");
	assert.equal(report.operations[0].durationMs, null);
	assert.equal(report.operations[0].category, "other");
	assert.equal(report.incomplete, true);
	assert.equal(report.signal, "SIGTERM");
	assert(output.join("").includes("ERROR: connection closed"));
	assert.match(renderBuildkit(report), /&lt;unfamiliar&gt;\\\|operation/u);
	assert.equal(parseBuildkit("").incomplete, true);
	assert.equal(parseBuildkit("").cacheExport, "unknown");
	assert.equal(parseBuildkit('null\n{"vertexes":').cacheExport, "unknown");
});

test("real child-process output is streamed and parsed without capturing all logs", async (t) => {
	const output: string[] = [];
	t.mock.method(process.stderr, "write", (text: string) => {
		output.push(text);
		return true;
	});
	const log =
		vertex({ digest: "a", name: "RUN pnpm install", started: time(0) }) +
		command("a", "Progress: resolved 2, reused 1, downloaded 1, added 2, done\n") +
		vertex({ digest: "a", started: time(0), completed: time(1) });
	const result = await runCommand(
		process.execPath,
		["-e", `process.stderr.write(${JSON.stringify(log)})`],
		{ cwd: process.cwd(), env: process.env, output: "buildkit" },
	);
	assert.equal(result.code, 0);
	assert.equal(result.stdout, "");
	assert.equal(result.stderr, "");
	assert.equal(result.buildkit?.operations[0].pnpm[0].reused, 1);
	assert.match(output.join(""), /\[buildkit-pnpm\] .*"operation":"a"/u);
	assert.match(output.join(""), /reused 1, downloaded 1/u);
});

test("child signal exits preserve the signal and unfinished phases", async (t) => {
	const output: string[] = [];
	t.mock.method(process.stderr, "write", (text: string) => {
		output.push(text);
		return true;
	});
	const log = vertex({ digest: "cache", name: "exporting cache to registry", started: time(0) });
	const result = await runCommand(
		process.execPath,
		[
			"-e",
			`process.stderr.write(${JSON.stringify(log)}, () => process.kill(process.pid, 'SIGTERM'))`,
		],
		{ cwd: process.cwd(), env: process.env, output: "buildkit" },
	);
	assert.notEqual(result.code, 0);
	assert.equal(result.signal, "SIGTERM");
	assert.equal(result.buildkit?.cacheExport, "unfinished");
	assert.match(
		output.join(""),
		/\[buildkit\] state=start operation="exporting cache to registry"/u,
	);
});
