import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { type CommandResult, type CommandRunner, publishImages } from "./images.mts";

const SHA = "a".repeat(40);
const FIRST_DIGEST = `sha256:${"b".repeat(64)}`;
const SECOND_DIGEST = `sha256:${"c".repeat(64)}`;

function result(overrides: Partial<CommandResult> = {}): CommandResult {
	return { code: 0, stderr: "", stdout: "", ...overrides };
}

function bakePrint(targets: string[]): CommandResult {
	return result({
		stdout: JSON.stringify({
			target: Object.fromEntries(targets.map((target) => [target, {}])),
		}),
	});
}

function manifest(digest: string, architectures: string[] = ["arm64"]): CommandResult {
	return result({
		stdout: JSON.stringify({
			manifest: {
				digest,
				manifests: architectures.map((architecture) => ({
					platform: { architecture, os: "linux" },
				})),
				mediaType: "application/vnd.oci.image.index.v1+json",
			},
		}),
	});
}

async function fixture(t: test.TestContext): Promise<{
	options: Parameters<typeof publishImages>[0];
	root: string;
}> {
	const root = await mkdtemp(path.join(os.tmpdir(), "campus-agent-image-test-"));
	t.after(() => rm(root, { force: true, recursive: true }));
	return {
		options: {
			images: ["agent-runtime"],
			outputFile: path.join(root, "digests.json"),
			repository: "MUC-WIKI/campus-agent",
			repositoryRoot: root,
			sourceSha: SHA,
			trivyCacheDirectory: path.join(root, "trivy"),
		},
		root,
	};
}

test("rejects image names that Docker Bake does not declare", async (t) => {
	const { options } = await fixture(t);
	await assert.rejects(
		publishImages(options, async () => bakePrint([])),
		/Image is not declared in docker-bake\.hcl: agent-runtime/u,
	);
});

test("reuses an existing immutable arm64 image index", async (t) => {
	const { options } = await fixture(t);
	const calls: string[] = [];
	const runner: CommandRunner = async (command, args) => {
		calls.push(`${command} ${args.join(" ")}`);
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		if (args.includes("imagetools")) {
			return manifest(FIRST_DIGEST);
		}
		return result();
	};

	assert.deepEqual(await publishImages(options, runner), {
		"agent-runtime": FIRST_DIGEST,
	});
	assert.equal(
		calls.some((call) => call.includes("--metadata-file")),
		false,
	);
	assert.equal(
		calls.some((call) => call.startsWith("trivy image")),
		true,
	);
});

test("rejects an existing immutable tag for the wrong architecture", async (t) => {
	const { options } = await fixture(t);
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		return manifest(FIRST_DIGEST, ["amd64"]);
	};

	await assert.rejects(publishImages(options, runner), /does not contain exactly one arm64 image/u);
});

test("rejects an existing immutable tag with additional Linux platforms", async (t) => {
	const { options } = await fixture(t);
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		return manifest(FIRST_DIGEST, ["arm64", "amd64"]);
	};

	await assert.rejects(publishImages(options, runner), /does not contain exactly one arm64 image/u);
});

test("does not treat an unexpected registry failure as a missing image", async (t) => {
	const { options } = await fixture(t);
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		return result({ code: 1, stderr: "registry authentication failed" });
	};

	await assert.rejects(publishImages(options, runner), /registry authentication failed/u);
});

test("reads the pushed digest from Docker Bake metadata", async (t) => {
	const { options } = await fixture(t);
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		if (args.includes("imagetools")) {
			return result({ code: 1, stderr: "manifest unknown" });
		}
		if (args.includes("--metadata-file")) {
			const metadataFile = args[args.indexOf("--metadata-file") + 1];
			assert.ok(metadataFile);
			await writeFile(
				metadataFile,
				JSON.stringify({
					"agent-runtime": { "containerimage.digest": FIRST_DIGEST },
				}),
			);
		}
		return result();
	};

	assert.deepEqual(await publishImages(options, runner), {
		"agent-runtime": FIRST_DIGEST,
	});
});

test("fails publication when Trivy rejects an image", async (t) => {
	const { options } = await fixture(t);
	const runner: CommandRunner = async (command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		if (args.includes("imagetools")) {
			return manifest(FIRST_DIGEST);
		}
		if (command === "trivy") {
			return result({
				code: 1,
				stderr: "scanner diagnostics",
				stdout: "CVE-2026-18446 HIGH fast-uri 3.1.4",
			});
		}
		return result();
	};

	await assert.rejects(publishImages(options, runner), (error: unknown) => {
		assert.match(String(error), /CVE-2026-18446 HIGH fast-uri 3\.1\.4/u);
		assert.match(String(error), /scanner diagnostics/u);
		return true;
	});
});

test("normalizes image order in the result and output file", async (t) => {
	const { options } = await fixture(t);
	options.images = ["ops-web", "agent-runtime"];
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["ops-web", "agent-runtime"]);
		}
		if (args.includes("imagetools")) {
			return args.some((argument) => argument.includes("/agent-runtime:"))
				? manifest(FIRST_DIGEST)
				: manifest(SECOND_DIGEST);
		}
		return result();
	};

	assert.deepEqual(await publishImages(options, runner), {
		"agent-runtime": FIRST_DIGEST,
		"ops-web": SECOND_DIGEST,
	});
	assert.equal(
		await readFile(options.outputFile, "utf8"),
		`${JSON.stringify({ "agent-runtime": FIRST_DIGEST, "ops-web": SECOND_DIGEST }, null, 2)}\n`,
	);
});
