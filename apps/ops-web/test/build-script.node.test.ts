import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";

const appRoot = join(import.meta.dirname, "..");
const buildScript = join(appRoot, "scripts/build.sh");

describe("ops-web build script", () => {
	it("preserves the license environment without logging its value", () => {
		const root = mkdtempSync(join(tmpdir(), "ops-web-build-script-"));
		try {
			const bin = join(root, "bin");
			const capture = join(root, "vite-calls.log");
			const vite = join(bin, "vite");
			mkdirSync(bin, { recursive: true });
			writeFileSync(
				vite,
				`#!/usr/bin/env bash\nprintf '%s\\t%s\\n' "\${VITE_TLDRAW_LICENSE_KEY-}" "$*" >> "$OPS_WEB_BUILD_CAPTURE"\n`,
				{ mode: 0o755 },
			);

			const key = "test-public-tldraw-key";
			const output = execFileSync("bash", [buildScript], {
				cwd: appRoot,
				encoding: "utf8",
				env: {
					...process.env,
					PATH: `${bin}:${process.env.PATH ?? ""}`,
					OPS_WEB_BUILD_CAPTURE: capture,
					VITE_TLDRAW_LICENSE_KEY: key,
				},
			});

			assert.match(output, /tldraw license key: configured/u);
			assert.doesNotMatch(output, new RegExp(key, "u"));
			const calls = readFileSync(capture, "utf8")
				.trimEnd()
				.split("\n")
				.map((line) => line.split("\t", 2));
			assert.equal(calls.length, 3);
			assert.deepEqual(
				calls.map(([value]) => value),
				[key, key, key],
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
