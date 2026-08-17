import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	type CommandOutput,
	type CommandResult,
	type CommandRunner,
	publishImages,
} from "./images.mts";

const SHA = "a".repeat(40);
const FIRST_DIGEST = `sha256:${"b".repeat(64)}`;
const SECOND_DIGEST = `sha256:${"c".repeat(64)}`;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

test("every Docker Bake target references an existing Dockerfile", async () => {
	const bake = await readFile(path.join(REPOSITORY_ROOT, "docker-bake.hcl"), "utf8");
	const dockerfiles = [...bake.matchAll(/^\s*dockerfile\s*=\s*"([^"]+)"\s*$/gmu)].map(
		(match) => match[1],
	);
	assert(dockerfiles.length > 0);
	for (const dockerfile of dockerfiles) {
		assert(dockerfile);
		await assert.doesNotReject(
			access(path.join(REPOSITORY_ROOT, dockerfile)),
			`${dockerfile} must exist`,
		);
	}
});

function manifest(
	digest: string,
	architecture = "arm64",
	revision: string | null = SHA,
	mediaType = "application/vnd.oci.image.manifest.v1+json",
): CommandResult {
	return result({
		stdout: JSON.stringify({
			image: {
				architecture,
				config: revision ? { Labels: { "org.opencontainers.image.revision": revision } } : {},
				os: "linux",
			},
			manifest: {
				digest,
				mediaType,
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
	await writeFile(path.join(root, ".node-version"), "99.88.77\n");
	return {
		options: {
			images: ["agent-runtime"],
			logger: () => undefined,
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

test("reuses an existing immutable linux/arm64 image", async (t) => {
	const { options } = await fixture(t);
	const calls: Array<{
		args: string[];
		command: string;
		nodeVersion?: string;
		output: CommandOutput;
	}> = [];
	const logs: string[] = [];
	options.logger = (message) => logs.push(message);
	options.summaryFile = path.join(options.repositoryRoot, "summary.md");
	const runner: CommandRunner = async (command, args, commandOptions) => {
		calls.push({
			args,
			command,
			nodeVersion: commandOptions.env.NODE_VERSION,
			output: commandOptions.output,
		});
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
		calls.some((call) => call.args.includes("--metadata-file")),
		false,
	);
	assert.deepEqual(
		calls.map(({ args, command, output }) => ({ command, output, subcommand: args[0] })),
		[
			{ command: "docker", output: "capture", subcommand: "buildx" },
			{ command: "docker", output: "capture", subcommand: "buildx" },
			{ command: "trivy", output: "capture", subcommand: "image" },
		],
	);
	assert(calls.every((call) => call.nodeVersion === "99.88.77"));
	assert(logs.some((line) => /stage=inspect state=complete .*reused=true/u.test(line)));
	assert(logs.some((line) => /stage=scan state=complete duration_ms=\d+/u.test(line)));
	assert(!logs.some((line) => line.includes("stage=build")));
	const summary = await readFile(options.summaryFile, "utf8");
	assert.match(summary, /\| `agent-runtime` \| reused \|/u);
	assert.match(summary, /\| \d+\.\d+s \| - \| \d+\.\d+s \| \d+\.\d+s \|/u);
	assert(summary.includes(FIRST_DIGEST));
});

test("rejects an existing immutable tag for the wrong architecture", async (t) => {
	const { options } = await fixture(t);
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		return manifest(FIRST_DIGEST, "amd64");
	};

	await assert.rejects(publishImages(options, runner), /not a linux\/arm64 image/u);
});

test("rejects an existing immutable multi-platform index", async (t) => {
	const { options } = await fixture(t);
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		return manifest(FIRST_DIGEST, "arm64", SHA, "application/vnd.oci.image.index.v1+json");
	};

	await assert.rejects(publishImages(options, runner), /not a single-platform image/u);
});

test("rejects an existing immutable tag without a source revision", async (t) => {
	const { options } = await fixture(t);
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		return manifest(FIRST_DIGEST, "arm64", null);
	};

	await assert.rejects(publishImages(options, runner), /has the wrong source revision/u);
});

test("rejects an existing immutable tag for a different source revision", async (t) => {
	const { options } = await fixture(t);
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		return manifest(FIRST_DIGEST, "arm64", "f".repeat(40));
	};

	await assert.rejects(publishImages(options, runner), /has the wrong source revision/u);
});

test("rejects the obsolete nested imagetools index shape", async (t) => {
	const { options } = await fixture(t);
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		return result({
			stdout: JSON.stringify({
				image: {
					"linux/arm64": {
						config: { Labels: { "org.opencontainers.image.revision": SHA } },
					},
				},
				manifest: {
					digest: FIRST_DIGEST,
					manifests: [{ platform: { architecture: "arm64", os: "linux" } }],
					mediaType: "application/vnd.oci.image.index.v1+json",
				},
			}),
		});
	};

	await assert.rejects(publishImages(options, runner), /not a single-platform image/u);
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
	const calls: Array<{ args: string[]; output: CommandOutput }> = [];
	const logs: string[] = [];
	options.logger = (message) => logs.push(message);
	options.summaryFile = path.join(options.repositoryRoot, "summary.md");
	const runner: CommandRunner = async (_command, args, commandOptions) => {
		calls.push({ args, output: commandOptions.output });
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
	const build = calls.find((call) => call.args.includes("--metadata-file"));
	assert(build);
	assert.equal(build.output, "stream");
	assert(build.args.includes("--progress=plain"));
	assert.equal(calls.find((call) => call.args.includes("--print"))?.output, "capture");
	assert.equal(calls.find((call) => call.args.includes("imagetools"))?.output, "capture");
	assert(logs.some((line) => line.includes("stage=build state=start")));
	assert(logs.some((line) => /stage=build state=complete duration_ms=\d+/u.test(line)));
	assert(logs.some((line) => line.includes("result=built")));
	assert.match(await readFile(options.summaryFile, "utf8"), /\| `agent-runtime` \| built \|/u);
});

test("records a build failure and leaves later images not started", async (t) => {
	const { options } = await fixture(t);
	options.images = ["ops-web", "agent-runtime"];
	options.summaryFile = path.join(options.repositoryRoot, "summary.md");
	const logs: string[] = [];
	options.logger = (message) => logs.push(message);
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(options.images);
		}
		if (args.includes("imagetools")) {
			return result({ code: 1, stderr: "manifest unknown" });
		}
		return result({ code: 1, stderr: "build failed" });
	};

	await assert.rejects(publishImages(options, runner), /build failed/u);
	assert(logs.some((line) => /image=agent-runtime stage=build state=failed/u.test(line)));
	assert(logs.some((line) => /image=agent-runtime stage=total state=failed/u.test(line)));
	const summary = await readFile(options.summaryFile, "utf8");
	assert.match(summary, /\| `agent-runtime` \| failed \(build\) \|/u);
	assert.match(summary, /\| `ops-web` \| not-started \|/u);
});

test("fails publication when Trivy rejects an image", async (t) => {
	const { options } = await fixture(t);
	const logs: string[] = [];
	options.logger = (message) => logs.push(message);
	options.summaryFile = path.join(options.repositoryRoot, "summary.md");
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
	assert(logs.some((line) => /stage=scan state=failed .*exit_code=1/u.test(line)));
	assert.match(
		await readFile(options.summaryFile, "utf8"),
		/\| `agent-runtime` \| failed \(scan\) \|/u,
	);
});

test("fails publication when the summary cannot be written", async (t) => {
	const { options } = await fixture(t);
	const logs: string[] = [];
	options.logger = (message) => logs.push(message);
	options.summaryFile = path.join(options.repositoryRoot, "missing", "summary.md");
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		if (args.includes("imagetools")) {
			return manifest(FIRST_DIGEST);
		}
		return result();
	};

	await assert.rejects(publishImages(options, runner), (error: unknown) => {
		assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
		return true;
	});
	assert(logs.some((line) => line.includes("summary state=failed original_error=false")));
	assert.equal(
		await readFile(options.outputFile, "utf8"),
		`${JSON.stringify({ "agent-runtime": FIRST_DIGEST }, null, 2)}\n`,
	);
});

test("preserves a scan failure when the summary also fails", async (t) => {
	const { options } = await fixture(t);
	const logs: string[] = [];
	options.logger = (message) => logs.push(message);
	options.summaryFile = path.join(options.repositoryRoot, "missing", "summary.md");
	const runner: CommandRunner = async (command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		if (args.includes("imagetools")) {
			return manifest(FIRST_DIGEST);
		}
		if (command === "trivy") {
			return result({ code: 1, stderr: "scanner diagnostics" });
		}
		return result();
	};

	await assert.rejects(publishImages(options, runner), (error: unknown) => {
		assert.match(String(error), /scanner diagnostics/u);
		assert.doesNotMatch(String(error), /ENOENT/u);
		return true;
	});
	assert(logs.some((line) => line.includes("summary state=failed original_error=true")));
});

test("normalizes image order in the result and output file", async (t) => {
	const { options } = await fixture(t);
	options.images = ["ops-web", "agent-runtime"];
	options.summaryFile = path.join(options.repositoryRoot, "summary.md");
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
	const summary = await readFile(options.summaryFile, "utf8");
	assert(summary.indexOf("`agent-runtime`") < summary.indexOf("`ops-web`"));
});
