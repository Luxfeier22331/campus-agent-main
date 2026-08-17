import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");

function capture(source: string, pattern: RegExp, label: string): string {
	const value = source.match(pattern)?.[1];
	assert(value, label);
	return value;
}

test("execution-control Docker image follows the go.mod toolchain version", () => {
	const goMod = readFileSync(path.join(ROOT, "apps/execution-control/go.mod"), "utf8");
	const dockerfile = readFileSync(path.join(ROOT, "apps/execution-control/Dockerfile"), "utf8");
	const languageVersion = capture(
		goMod,
		/^go ([0-9]+[.][0-9]+)$/mu,
		"go.mod must declare a major/minor language version",
	);
	const toolchainVersion = capture(
		goMod,
		/^toolchain go([0-9]+[.][0-9]+[.][0-9]+)$/mu,
		"go.mod must declare a complete toolchain version",
	);
	const dockerVersion = capture(
		dockerfile,
		/^FROM --platform=[$]BUILDPLATFORM golang:([0-9]+[.][0-9]+[.][0-9]+)-bookworm AS build$/mu,
		"execution-control Dockerfile must pin the Go bookworm build image",
	);

	assert.equal(
		toolchainVersion.split(".").slice(0, 2).join("."),
		languageVersion,
		"go.mod language and toolchain versions must share major/minor",
	);
	assert.equal(
		dockerVersion,
		toolchainVersion,
		"Dockerfile Go version must match go.mod toolchain",
	);
});
