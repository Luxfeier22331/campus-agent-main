import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parseBuildkit } from "../release/buildkit-progress.mts";
import { localRegistry } from "./measure-image.mts";

test("BuildKit measurement merges updates and preserves overlapping and unfinished vertices", () => {
	const vertices = parseBuildkit(
		[
			JSON.stringify({
				vertexes: [{ digest: "a", name: "install", started: "2026-09-10T00:00:00Z" }],
			}),
			JSON.stringify({
				vertexes: [
					{
						digest: "b",
						name: "COPY",
						started: "2026-09-10T00:00:01Z",
						completed: "2026-09-10T00:00:02Z",
						cached: true,
					},
				],
			}),
			JSON.stringify({ vertexes: [{ digest: "a", completed: "2026-09-10T00:00:03Z" }] }),
			JSON.stringify({ id: "c", name: "export", started: "2026-09-10T00:00:02Z" }),
			"ERROR: cancelled",
		].join("\n"),
	);
	assert.deepEqual(
		vertices.operations.map((vertex) => [vertex.name, vertex.durationMs]),
		[
			["install", 3000],
			["COPY", 1000],
			["export", null],
		],
	);
	assert.equal(vertices.operations[1].cached, true);
});

test("measurement exports only to an explicit local registry", () => {
	assert.deepEqual(localRegistry("127.0.0.1:15000/ops/cache:baseline"), {
		host: "127.0.0.1:15000",
		repository: "ops/cache",
		tag: "baseline",
	});
	for (const ref of [
		"ghcr.io/owner/ops:tag",
		"localhost/ops:tag",
		"127.0.0.1:15000/ops",
		"127.0.0.1:15000/ops:tag,mode=max",
	]) {
		assert.throws(() => localRegistry(ref));
	}
});

test("measurement CLI passes Bake exports and records registry cache bytes", async () => {
	const directory = mkdtempSync(path.join(tmpdir(), "image-measure-"));
	const requests: string[] = [];
	const server = createServer((request, response) => {
		requests.push(request.url ?? "");
		response.setHeader("Content-Type", "application/vnd.oci.image.manifest.v1+json");
		response.end(JSON.stringify({ layers: [{ size: 120 }, { size: 80 }] }));
	});
	try {
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		assert(address && typeof address !== "string");
		const registry = `127.0.0.1:${address.port}`;
		writeFileSync(
			path.join(directory, "docker"),
			`#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync("arguments.json", JSON.stringify(args));
fs.writeFileSync(args[args.indexOf("--metadata-file") + 1], JSON.stringify({ "containerimage.digest": "sha256:local-test" }));
process.stderr.write(JSON.stringify({ vertexes: [{ digest: "export", name: "exporting cache", started: "2026-09-10T00:00:00Z", completed: "2026-09-10T00:00:01Z" }] }) + "\\n");
`,
			{ mode: 0o755 },
		);
		const output = path.join(directory, "output");
		await promisify(execFile)(
			process.execPath,
			[
				path.join(import.meta.dirname, "measure-image.mts"),
				"--builder",
				"isolated-test",
				"--context",
				directory,
				"--cache-ref",
				`${registry}/cache:test`,
				"--image-ref",
				`${registry}/ops:test`,
				"--output",
				output,
				"--import-cache",
			],
			{ cwd: directory, env: { PATH: directory } },
		);
		const args = JSON.parse(readFileSync(path.join(directory, "arguments.json"), "utf8"));
		for (const argument of [
			"ops-web.platform=linux/arm64",
			"ops-web.output=type=registry",
			`ops-web.cache-to=type=registry,ref=${registry}/cache:test,mode=max`,
			`ops-web.cache-from=type=registry,ref=${registry}/cache:test`,
		]) {
			assert(args.includes(argument), argument);
		}
		const report = JSON.parse(readFileSync(path.join(output, "report.json"), "utf8"));
		assert.equal(report.exitCode, 0);
		assert.equal(report.cacheBytes, 200);
		assert.equal(report.buildkit.operations[0].durationMs, 1000);
		assert.deepEqual(requests, ["/v2/cache/manifests/test"]);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(directory, { recursive: true, force: true });
	}
});
