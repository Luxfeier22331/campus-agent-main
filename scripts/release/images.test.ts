import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	buildImages,
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
	manifests?: Array<{
		annotations?: Record<string, string>;
		platform: { architecture: string; os: string };
	}>,
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
				...(manifests ? { manifests } : {}),
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
	assert(logs.some((line) => /stage=run state=start .*cache_mode=max/u.test(line)));
	assert(logs.some((line) => /stage=inspect state=complete .*reused=true/u.test(line)));
	assert(logs.some((line) => /stage=scan state=complete duration_ms=\d+/u.test(line)));
	assert(logs.some((line) => /stage=run state=complete .*reused=1/u.test(line)));
	assert(!logs.some((line) => line.includes("stage=build")));
	const summary = await readFile(options.summaryFile, "utf8");
	assert.match(summary, /Script duration: \d+\.\ds/u);
	assert.match(summary, /Cache: registry with mode=max/u);
	assert.match(summary, /Results: built=0 reused=1 failed=0 not-started=0/u);
	assert.match(summary, /Trivy feedback: recorded=1 warnings=0 not-run=0/u);
	assert.match(summary, /\| `agent-runtime` \| reused \| \d+\.\d+s \| - \| recorded \|/u);
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

test("reuses an existing immutable arm64 index with an attestation manifest", async (t) => {
	const { options } = await fixture(t);
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		return manifest(FIRST_DIGEST, "arm64", SHA, "application/vnd.oci.image.index.v1+json", [
			{ platform: { architecture: "arm64", os: "linux" } },
			{
				annotations: { "vnd.docker.reference.type": "attestation-manifest" },
				platform: { architecture: "unknown", os: "unknown" },
			},
		]);
	};

	assert.deepEqual(await publishImages(options, runner), {
		"agent-runtime": FIRST_DIGEST,
	});
});

test("rejects an existing immutable multi-platform index", async (t) => {
	const { options } = await fixture(t);
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		return manifest(FIRST_DIGEST, "arm64", SHA, "application/vnd.oci.image.index.v1+json", [
			{ platform: { architecture: "arm64", os: "linux" } },
			{ platform: { architecture: "amd64", os: "linux" } },
		]);
	};

	await assert.rejects(
		publishImages(options, runner),
		/does not contain exactly one linux\/arm64 image/u,
	);
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

	await assert.rejects(publishImages(options, runner), /not a linux\/arm64 image/u);
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
	assert.equal(
		build.args.find((argument) => argument.includes(".cache-from=")),
		"agent-runtime.cache-from=type=registry,ref=ghcr.io/muc-wiki/campus-agent/agent-runtime:buildcache-arm64",
	);
	assert.equal(
		build.args.find((argument) => argument.includes(".cache-to=")),
		"agent-runtime.cache-to=type=registry,ref=ghcr.io/muc-wiki/campus-agent/agent-runtime:buildcache-arm64,mode=max,image-manifest=true,oci-mediatypes=true,ignore-error=true",
	);
	assert.equal(calls.find((call) => call.args.includes("--print"))?.output, "capture");
	assert.equal(calls.find((call) => call.args.includes("imagetools"))?.output, "capture");
	assert(
		logs.some(
			(line) =>
				/ stage=build state=start /u.test(line) &&
				line.includes("cache_type=registry") &&
				line.includes("cache_mode=max") &&
				line.includes("duration_scope=build_push_cache_export"),
		),
	);
	assert(logs.some((line) => /stage=build state=complete duration_ms=\d+/u.test(line)));
	assert(logs.some((line) => /stage=run state=complete .*built=1/u.test(line)));
	assert(logs.some((line) => line.includes("result=built")));
	const summary = await readFile(options.summaryFile, "utf8");
	assert.match(summary, /Build\/push\/cache export/u);
	assert.match(summary, /Results: built=1 reused=0 failed=0 not-started=0/u);
	assert.match(summary, /\| `agent-runtime` \| built \|/u);
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
	assert(logs.some((line) => /stage=run state=failed .*failed=1 not_started=1/u.test(line)));
	const summary = await readFile(options.summaryFile, "utf8");
	assert.match(summary, /Results: built=0 reused=0 failed=1 not-started=1/u);
	assert.match(summary, /\| `agent-runtime` \| failed \(build\) \|/u);
	assert.match(summary, /\| `ops-web` \| not-started \|/u);
});

test("records non-zero Trivy output as non-blocking feedback", async (t) => {
	const { options } = await fixture(t);
	options.images = ["ops-web", "agent-runtime"];
	const logs: string[] = [];
	const trivyArguments: string[][] = [];
	options.logger = (message) => logs.push(message);
	options.summaryFile = path.join(options.repositoryRoot, "summary.md");
	const runner: CommandRunner = async (command, args) => {
		if (args.includes("--print")) {
			return bakePrint(options.images);
		}
		if (args.includes("imagetools")) {
			return args.some((argument) => argument.includes("/agent-runtime:"))
				? manifest(FIRST_DIGEST)
				: manifest(SECOND_DIGEST);
		}
		if (command === "trivy") {
			trivyArguments.push(args);
			if (args.some((argument) => argument.includes("/ops-web@"))) {
				return result({ stdout: "ops web feedback" });
			}
			return result({
				code: 2,
				stderr: "scanner diagnostics",
				stdout: "CVE-2026-18446 HIGH fast-uri 3.1.4",
			});
		}
		return result();
	};

	assert.deepEqual(await publishImages(options, runner), {
		"agent-runtime": FIRST_DIGEST,
		"ops-web": SECOND_DIGEST,
	});
	assert.equal(trivyArguments.length, 2);
	for (const args of trivyArguments) {
		const exitCodeIndex = args.indexOf("--exit-code");
		assert.equal(args[exitCodeIndex + 1], "0");
	}
	assert(logs.includes("CVE-2026-18446 HIGH fast-uri 3.1.4\n"));
	assert(logs.includes("scanner diagnostics\n"));
	assert(logs.includes("ops web feedback\n"));
	assert(logs.some((line) => /stage=scan state=warning .*exit_code=2 blocking=false/u.test(line)));
	const summary = await readFile(options.summaryFile, "utf8");
	assert.match(summary, /Results: built=0 reused=2 failed=0 not-started=0/u);
	assert.match(summary, /Trivy feedback: recorded=1 warnings=1 not-run=0/u);
	assert.match(summary, /\| `agent-runtime` \| reused \| \d+\.\d+s \| - \| warning \|/u);
});

test("continues with later images when the Trivy process throws", async (t) => {
	const { options } = await fixture(t);
	options.images = ["ops-web", "agent-runtime"];
	options.summaryFile = path.join(options.repositoryRoot, "summary.md");
	const logs: string[] = [];
	options.logger = (message) => logs.push(message);
	let scanCalls = 0;
	const runner: CommandRunner = async (command, args) => {
		if (args.includes("--print")) {
			return bakePrint(options.images);
		}
		if (args.includes("imagetools")) {
			return args.some((argument) => argument.includes("/agent-runtime:"))
				? manifest(FIRST_DIGEST)
				: manifest(SECOND_DIGEST);
		}
		if (command === "trivy") {
			scanCalls += 1;
			if (scanCalls === 1) {
				throw new Error("trivy process unavailable");
			}
			return result({ stdout: "second image feedback" });
		}
		return result();
	};

	assert.deepEqual(await publishImages(options, runner), {
		"agent-runtime": FIRST_DIGEST,
		"ops-web": SECOND_DIGEST,
	});
	assert.equal(scanCalls, 2);
	assert(logs.some((line) => line.includes("trivy process unavailable")));
	assert(
		logs.some((line) => /stage=scan state=warning .*error=execution blocking=false/u.test(line)),
	);
	assert(logs.includes("second image feedback\n"));
	assert.match(
		await readFile(options.summaryFile, "utf8"),
		/Trivy feedback: recorded=1 warnings=1 not-run=0/u,
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

test("keeps a summary write failure blocking after a Trivy warning", async (t) => {
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
		assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
		return true;
	});
	assert(logs.includes("scanner diagnostics\n"));
	assert(logs.some((line) => line.includes("summary state=failed original_error=false")));
	assert.equal(
		await readFile(options.outputFile, "utf8"),
		`${JSON.stringify({ "agent-runtime": FIRST_DIGEST }, null, 2)}\n`,
	);
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

test("build-only evidence builds selected targets without publishing or scanning", async (t) => {
	const { options } = await fixture(t);
	const logs: string[] = [];
	const calls: Array<{
		args: string[];
		command: string;
		env: NodeJS.ProcessEnv;
		output: CommandOutput;
	}> = [];
	const summaryFile = path.join(options.repositoryRoot, "summary.md");
	const runner: CommandRunner = async (command, args, commandOptions) => {
		calls.push({ command, args, env: commandOptions.env, output: commandOptions.output });
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime", "ops-web"]);
		}
		return result();
	};

	await buildImages(
		{
			images: ["ops-web", "agent-runtime"],
			logger: (message) => logs.push(message),
			repository: options.repository,
			repositoryRoot: options.repositoryRoot,
			sourceSha: options.sourceSha,
			summaryFile,
		},
		runner,
	);

	assert.deepEqual(
		calls.map(({ command, args, output }) => ({
			command,
			output,
			subcommand: args[0],
		})),
		[
			{ command: "docker", output: "capture", subcommand: "buildx" },
			{ command: "docker", output: "stream", subcommand: "buildx" },
			{ command: "docker", output: "stream", subcommand: "buildx" },
		],
	);
	const builds = calls.filter((call) => call.output === "stream");
	assert.equal(builds.length, 2);
	for (const build of builds) {
		assert(build.args.includes("--pull"));
		assert(build.args.includes("--progress=plain"));
		assert(build.args.includes("--provenance=false"));
		assert(build.args.includes("--sbom=false"));
		assert(build.args.includes("--set"));
		assert(build.args.some((argument) => argument.endsWith(".platform=linux/arm64")));
		assert(build.args.some((argument) => argument.endsWith(".output=type=cacheonly")));
		assert.equal(build.args.includes("--push"), false);
		assert.equal(build.args.includes("--load"), false);
		assert.equal(build.args.includes("--metadata-file"), false);
		assert.equal(build.env.IMAGE_REVISION, SHA);
		assert.equal(build.env.IMAGE_SOURCE, "https://github.com/MUC-WIKI/campus-agent");
		assert.equal(build.env.NODE_VERSION, "99.88.77");
	}
	assert.equal(
		calls.some((call) => call.command === "trivy"),
		false,
	);
	assert.equal(
		calls.some((call) => call.args.includes("imagetools")),
		false,
	);
	assert(logs.some((line) => line.includes("mode=build-only output=cacheonly")));
	assert(logs.some((line) => line.includes("stage=run state=complete")));
	const summary = await readFile(summaryFile, "utf8");
	assert.match(summary, /Container build results/u);
	assert.match(summary, /Output: BuildKit cacheonly/u);
	assert.match(summary, /Results: built=2 reused=0 failed=0 not-started=0/u);
	assert.match(summary, /\| `agent-runtime` \| built \|/u);
	assert.match(summary, /\| `ops-web` \| built \|/u);
});

test("build-only evidence stops after the first failed image", async (t) => {
	const { options } = await fixture(t);
	const logs: string[] = [];
	const calls: string[] = [];
	const summaryFile = path.join(options.repositoryRoot, "summary.md");
	const runner: CommandRunner = async (command, args) => {
		calls.push([command, ...args].join(" "));
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime", "ops-web"]);
		}
		return result({ code: 1, stderr: "build failed" });
	};

	await assert.rejects(
		buildImages(
			{
				images: ["agent-runtime", "ops-web"],
				logger: (message) => logs.push(message),
				repository: options.repository,
				repositoryRoot: options.repositoryRoot,
				sourceSha: options.sourceSha,
				summaryFile,
			},
			runner,
		),
		/build failed/u,
	);
	assert.equal(calls.filter((call) => call.includes("--progress=plain")).length, 1);
	assert(logs.some((line) => line.includes("failed=1 not_started=1")));
	assert.match(await readFile(summaryFile, "utf8"), /not-started/u);
});
