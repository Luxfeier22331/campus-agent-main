import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseBuildkit } from "./buildkit-progress.mts";
import {
	bakeBatches,
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

test("batch selection rejects overlapping and missing group membership", () => {
	const source = (heavy: string[], standard: string[]) =>
		JSON.stringify({
			target: { "ops-web": {} },
			group: { heavy: { targets: heavy }, standard: { targets: standard } },
		});
	assert.throws(() => bakeBatches(source(["ops-web"], ["ops-web"]), ["ops-web"]), /exactly one/u);
	assert.throws(() => bakeBatches(source([], []), ["ops-web"]), /exactly one/u);
	assert.deepEqual(bakeBatches(source(["ops-web"], []), ["ops-web"]), [
		{ name: "heavy", images: ["ops-web"] },
	]);
});

test("active selected images run serially in two groups with PR and canonical cache imports", async (t) => {
	const { options } = await fixture(t);
	const bake = await readFile(path.join(REPOSITORY_ROOT, "docker-bake.hcl"), "utf8");
	const images = [...bake.matchAll(/^target "([a-z][a-z-]+)"/gmu)].map((match) => match[1]);
	assert.equal(images.length, 11);
	const calls: string[][] = [];
	const firstEntered = Promise.withResolvers<void>();
	const releaseFirst = Promise.withResolvers<void>();
	const logs: string[] = [];
	const building = buildImages(
		{
			...options,
			images,
			logger: (message) => logs.push(message),
			cacheImportRegistries: ["ghcr.io/test/pr-cache-442", "ghcr.io/test/main"],
			cacheExportRegistry: "ghcr.io/test/pr-cache-442",
		},
		async (_command, args) => {
			if (args.includes("--print")) {
				return bakePrint(images);
			}
			calls.push(args);
			if (calls.length === 1) {
				firstEntered.resolve();
				await releaseFirst.promise;
			}
			return result();
		},
	);
	await firstEntered.promise;
	try {
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(calls.length, 1, "the next target must wait for the first Bake command");
	} finally {
		releaseFirst.resolve();
		await building;
	}
	assert.equal(calls.length, images.length);
	assert.deepEqual(
		calls.map((args) => args.at(-1)),
		[
			"agent-control",
			"campus-search-service",
			"memory-service",
			"model-config",
			"ops-web",
			...images
				.filter(
					(image) =>
						![
							"agent-control",
							"memory-service",
							"model-config",
							"ops-web",
							"campus-search-service",
						].includes(image),
				)
				.sort(),
		],
	);
	const batchLogs = logs
		.filter((line) => line.startsWith("[release-batch] "))
		.map((line) => JSON.parse(line.slice(16)));
	assert.deepEqual(
		batchLogs.map(({ batch, state }) => [batch, state]),
		[
			["heavy", "start"],
			["heavy", "success"],
			["standard", "start"],
			["standard", "success"],
		],
	);
	for (const args of calls) {
		assert.equal(args.filter((arg) => images.includes(arg)).length, 1);
		for (const image of args.filter((arg) => images.includes(arg))) {
			assert(
				args.includes(
					`${image}.cache-from=type=registry,ref=ghcr.io/test/pr-cache-442/${image}:buildcache-arm64`,
				),
			);
			assert(
				args.includes(
					`${image}.cache-from+=type=registry,ref=ghcr.io/test/main/${image}:buildcache-arm64`,
				),
			);
			assert(
				args.includes(
					`${image}.cache-to=type=registry,ref=ghcr.io/test/pr-cache-442/${image}:buildcache-arm64,mode=max,image-manifest=true,oci-mediatypes=true,ignore-error=true`,
				),
			);
		}
		assert(!args.includes("--push"));
	}
});

test("publication preserves completed targets and stops on failure or cancellation without publishing partial digests", async (t) => {
	for (const failure of ["exit code 1", "context canceled"]) {
		await t.test(failure, async (t) => {
			const { options } = await fixture(t);
			options.images = ["ops-web", "model-config", "agent-control", "agent-runtime"];
			options.summaryFile = path.join(options.repositoryRoot, "summary.md");
			const calls: string[] = [];
			await assert.rejects(
				publishImages(options, async (_command, args) => {
					if (args.includes("--print")) {
						return bakePrint(options.images);
					}
					if (args.includes("imagetools")) {
						return result({ code: 1, stderr: "manifest unknown" });
					}
					const target = args.at(-1) as string;
					calls.push(target);
					if (target === "agent-control") {
						await writeFile(
							args[args.indexOf("--metadata-file") + 1],
							JSON.stringify({ [target]: { "containerimage.digest": FIRST_DIGEST } }),
						);
						return result();
					}
					return result({
						code: 1,
						stderr: failure,
						buildkit: parseBuildkit(
							JSON.stringify({
								vertexes: [
									{ digest: "bad", name: "[model-config build 1/1] RUN go build", error: failure },
								],
							}),
						),
					});
				}),
				new RegExp(failure, "u"),
			);
			assert.deepEqual(calls, ["agent-control", "model-config"]);
			const summary = await readFile(options.summaryFile, "utf8");
			assert(summary.includes("| `agent-control` | built |"));
			assert(
				summary.includes(
					`| \`model-config\` | ${failure === "context canceled" ? "unfinished" : "failed (build)"} |`,
				),
			);
			assert(summary.includes("| `ops-web` | not-started |"));
			assert(summary.includes("| `agent-runtime` | not-started |"));
			await assert.rejects(access(options.outputFile));
		});
	}
});

test("serial builds retain each image's phases and do not hide an earlier cache warning", async (t) => {
	const { options } = await fixture(t);
	const images = ["agent-runtime", "campus-agent-schema"];
	const logs: string[] = [];
	const summaryFile = path.join(options.repositoryRoot, "summary.md");
	await buildImages(
		{ ...options, images, summaryFile, logger: (message) => logs.push(message) },
		async (_command, args) => {
			if (args.includes("--print")) {
				return bakePrint(images);
			}
			const image = args.at(-1);
			return result({
				buildkit: parseBuildkit(
					JSON.stringify({
						vertexes: [
							{
								digest: "cache",
								name: `[${image}] exporting cache to registry`,
								started: "2026-09-20T00:00:00Z",
								completed: "2026-09-20T00:00:01Z",
								...(image === "agent-runtime"
									? { error: "error writing layer blob: no active session" }
									: {}),
							},
						],
					}),
				),
			});
		},
	);
	const summary = await readFile(summaryFile, "utf8");
	for (const image of images) {
		assert(summary.includes(`Build phases: ${image}`));
	}
	assert.match(summary, /Cache export: \*\*warning\*\*/u);
	assert.match(summary, /Cache export: \*\*success\*\*/u);
	assert(
		logs.some(
			(line) =>
				line.startsWith("[release-batch] ") &&
				line.includes('"state":"success"') &&
				line.includes('"cacheExport":"warning"'),
		),
	);
});

function result(overrides: Partial<CommandResult> = {}): CommandResult {
	return { code: 0, stderr: "", stdout: "", ...overrides };
}

function bakePrint(targets: string[]): CommandResult {
	return result({
		stdout: JSON.stringify({
			target: Object.fromEntries(targets.map((target) => [target, {}])),
			group: {
				heavy: {
					targets: targets.filter((target) =>
						[
							"ops-web",
							"agent-control",
							"memory-service",
							"campus-search-service",
							"model-config",
						].includes(target),
					),
				},
				standard: {
					targets: targets.filter(
						(target) =>
							![
								"ops-web",
								"agent-control",
								"memory-service",
								"campus-search-service",
								"model-config",
							].includes(target),
					),
				},
			},
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

test("Docker Bake groups cover all targets without overlap", async () => {
	const bake = await readFile(path.join(REPOSITORY_ROOT, "docker-bake.hcl"), "utf8");
	const groupTargets = (name: string) => {
		const match = bake.match(new RegExp(String.raw`group "${name}" \{([\s\S]*?)\n\}`, "u"));
		assert(match, `${name} group must exist`);
		return [...match[1].matchAll(/"([a-z0-9-]+)"/gu)].map((entry) => entry[1]);
	};
	const heavy = groupTargets("heavy");
	const standard = groupTargets("standard");
	assert.deepEqual(new Set(heavy).intersection(new Set(standard)).size, 0);
	assert.deepEqual(
		new Set([...heavy, ...standard]),
		new Set([
			"document-ocr",
			"agent-runtime",
			"campus-agent-schema",
			"retrieval-index",
			"notice-pipeline-worker",
			"agent-control",
			"memory-service",
			"cluster-private-ingress",
			"model-config",
			"ops-web",
			"campus-search-service",
		]),
	);
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

test("publication excludes reused targets and publishes each missing target with separate metadata", async (t) => {
	const { options } = await fixture(t);
	options.images = ["ops-web", "model-config", "agent-control", "agent-runtime"];
	const calls: string[][] = [];
	const runner: CommandRunner = async (command, args) => {
		if (args.includes("--print")) {
			return bakePrint(options.images);
		}
		if (args.includes("imagetools")) {
			return args.some((arg) => arg.includes(`/model-config:${SHA}`))
				? manifest(FIRST_DIGEST)
				: result({ code: 1, stderr: "manifest unknown" });
		}
		if (command === "trivy") {
			return result();
		}
		calls.push(args);
		const targets = args.filter((arg) => options.images.includes(arg));
		const metadata = args[args.indexOf("--metadata-file") + 1];
		await writeFile(
			metadata,
			JSON.stringify(
				Object.fromEntries(
					targets.map((image) => [image, { "containerimage.digest": SECOND_DIGEST }]),
				),
			),
		);
		assert(!args.some((arg) => arg.includes("pr-cache")));
		for (const image of targets) {
			assert(
				args.includes(
					`${image}.cache-from=type=registry,ref=ghcr.io/muc-wiki/campus-agent/${image}:buildcache-arm64`,
				),
			);
		}
		return result();
	};
	const digests = await publishImages(options, runner);
	assert.deepEqual(
		calls.map((args) => args.filter((arg) => options.images.includes(arg))),
		[["agent-control"], ["ops-web"], ["agent-runtime"]],
	);
	assert.equal(new Set(calls.map((args) => args[args.indexOf("--metadata-file") + 1])).size, 3);
	assert.deepEqual(digests, {
		"agent-runtime": SECOND_DIGEST,
		"agent-control": SECOND_DIGEST,
		"model-config": FIRST_DIGEST,
		"ops-web": SECOND_DIGEST,
	});
	assert.deepEqual(JSON.parse(await readFile(options.outputFile, "utf8")), digests);
});

test("missing metadata leaves publication unfinished and does not write a digest map", async (t) => {
	const { options } = await fixture(t);
	options.summaryFile = path.join(options.repositoryRoot, "summary.md");
	await assert.rejects(
		publishImages(options, async (_command, args) => {
			if (args.includes("--print")) {
				return bakePrint(options.images);
			}
			if (args.includes("imagetools")) {
				return result({ code: 1, stderr: "manifest unknown" });
			}
			return result();
		}),
		/ENOENT/u,
	);
	assert(
		(await readFile(options.summaryFile, "utf8")).includes("| `agent-runtime` | unfinished |"),
	);
	await assert.rejects(access(options.outputFile));
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
	assert.match(summary, /Results: built=0 reused=1 failed=0 unfinished=0 not-started=0/u);
	assert.match(summary, /Build and cache export: not run\./u);
	assert.match(summary, /Trivy feedback: recorded=1 warnings=0 not-run=0/u);
	assert.match(summary, /\| `agent-runtime` \| reused \| \d+\.\d+s \| recorded \|/u);
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
	assert.equal(build.output, "buildkit");
	assert(build.args.includes("--progress=rawjson"));
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
			(line) => line.startsWith("[release-batch] ") && JSON.parse(line.slice(16)).state === "start",
		),
	);
	assert(
		logs.some(
			(line) =>
				line.startsWith("[release-batch] ") && JSON.parse(line.slice(16)).state === "success",
		),
	);
	assert(logs.some((line) => /stage=run state=complete .*built=1/u.test(line)));
	const summary = await readFile(options.summaryFile, "utf8");
	assert.match(summary, /Build\/push\/cache export/u);
	assert.match(summary, /Results: built=1 reused=0 failed=0 unfinished=0 not-started=0/u);
	assert.match(summary, /\| `agent-runtime` \| built \|/u);
});

test("publication keeps an ignored cache export failure visible without blocking the image", async (t) => {
	const { options } = await fixture(t);
	options.summaryFile = path.join(options.repositoryRoot, "summary.md");
	const logs: string[] = [];
	options.logger = (message) => logs.push(message);
	const buildkit = parseBuildkit(
		JSON.stringify({
			vertexes: [
				{
					digest: "image",
					name: "exporting to image",
					started: "2026-09-10T00:00:00Z",
					completed: "2026-09-10T00:00:01Z",
				},
				{
					digest: "cache",
					name: "exporting cache to registry",
					started: "2026-09-10T00:00:01Z",
					completed: "2026-09-10T00:00:02Z",
					error: "403 forbidden",
				},
			],
		}),
	);
	const runner: CommandRunner = async (_command, args, commandOptions) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		if (args.includes("imagetools")) {
			return result({ code: 1, stderr: "manifest unknown" });
		}
		if (commandOptions.output === "buildkit") {
			await writeFile(
				args[args.indexOf("--metadata-file") + 1],
				JSON.stringify({ "agent-runtime": { "containerimage.digest": FIRST_DIGEST } }),
			);
			return result({ buildkit });
		}
		return result();
	};
	assert.deepEqual(await publishImages(options, runner), { "agent-runtime": FIRST_DIGEST });
	const summary = await readFile(options.summaryFile, "utf8");
	assert.match(summary, /Results: built=1/u);
	assert.match(summary, /Cache export: \*\*warning\*\*/u);
	assert.match(summary, /Cache export warnings: `agent-runtime`/u);
	assert.match(summary, /403 forbidden/u);
	assert(
		logs.some(
			(line) => line.includes("stage=build state=warning") && line.includes("cache_export=warning"),
		),
	);
	assert(logs.some((line) => line.includes("::warning::Image agent-runtime cache export warning")));
});

test("failed builds keep completed phases and unfinished cache export in the summary", async (t) => {
	const { options } = await fixture(t);
	options.summaryFile = path.join(options.repositoryRoot, "summary.md");
	const buildkit = parseBuildkit(
		JSON.stringify({
			vertexes: [
				{
					digest: "install",
					name: "RUN pnpm install",
					started: "2026-09-10T00:00:00Z",
					completed: "2026-09-10T00:00:01Z",
				},
				{ digest: "cache", name: "exporting cache to registry", started: "2026-09-10T00:00:01Z" },
			],
		}),
	);
	const runner: CommandRunner = async (_command, args) => {
		if (args.includes("--print")) {
			return bakePrint(["agent-runtime"]);
		}
		if (args.includes("imagetools")) {
			return result({ code: 1, stderr: "manifest unknown" });
		}
		return result({ code: 1, stderr: "connection closed", buildkit });
	};
	await assert.rejects(publishImages(options, runner), /connection closed/u);
	const summary = await readFile(options.summaryFile, "utf8");
	assert.match(summary, /RUN pnpm install \| complete/u);
	assert.match(summary, /Cache export: \*\*unfinished\*\*/u);
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
	assert(
		logs.some(
			(line) =>
				line.startsWith("[release-batch] ") && JSON.parse(line.slice(16)).state === "failure",
		),
	);
	const summary = await readFile(options.summaryFile, "utf8");
	assert.match(summary, /failed=1 unfinished=0 not-started=1/u);
	assert.match(summary, /\| `ops-web` \| failed \(build\) \|/u);
	assert.match(summary, /\| `agent-runtime` \| not-started \|/u);
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
	assert.match(summary, /Results: built=0 reused=2 failed=0 unfinished=0 not-started=0/u);
	assert.match(summary, /Trivy feedback: recorded=1 warnings=1 not-run=0/u);
	assert.match(summary, /\| `agent-runtime` \| reused \| \d+\.\d+s \| warning \|/u);
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
			cacheImportRegistries: ["GHCR.IO/MUC-WIKI/CAMPUS-AGENT"],
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
			{ command: "docker", output: "buildkit", subcommand: "buildx" },
			{ command: "docker", output: "buildkit", subcommand: "buildx" },
		],
	);
	const builds = calls.filter((call) => call.output === "buildkit");
	assert.equal(builds.length, 2);
	for (const build of builds) {
		assert(build.args.includes("--pull"));
		assert(build.args.includes("--progress=rawjson"));
		assert(
			build.args.includes(
				`${build.args.at(-1)}.cache-from=type=registry,ref=ghcr.io/muc-wiki/campus-agent/${build.args.at(-1)}:buildcache-arm64`,
			),
		);
		assert.equal(
			build.args.some((arg) => arg.includes(".cache-to=")),
			false,
		);
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
	assert.match(summary, /Results: built=2 reused=0 failed=0 unfinished=0 not-started=0/u);
	assert.match(summary, /\| `agent-runtime` \| built \|/u);
	assert.match(summary, /\| `ops-web` \| built \|/u);
});

test("build-only can export an isolated PR cache without publishing an image", async (t) => {
	const { options } = await fixture(t);
	const calls: Array<{ args: string[]; output: CommandOutput }> = [];
	await buildImages(
		{
			...options,
			images: ["ops-web"],
			cacheImportRegistries: ["ghcr.io/muc-wiki/campus-agent"],
			cacheExportRegistry: "ghcr.io/muc-wiki/campus-agent/pr-cache-442",
		},
		async (_command, args, commandOptions) => {
			calls.push({ args, output: commandOptions.output });
			if (args.includes("--print")) {
				return bakePrint(["ops-web"]);
			}
			return result();
		},
	);
	const build = calls.find((call) => call.output === "buildkit");
	assert(build);
	assert(
		build.args.some((arg) =>
			arg.includes(
				".cache-from=type=registry,ref=ghcr.io/muc-wiki/campus-agent/ops-web:buildcache-arm64",
			),
		),
	);
	assert(
		build.args.some((arg) =>
			arg.includes(
				".cache-to=type=registry,ref=ghcr.io/muc-wiki/campus-agent/pr-cache-442/ops-web:buildcache-arm64",
			),
		),
	);
	assert.equal(build.args.includes("--push"), false);
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
	assert.equal(calls.filter((call) => call.includes("--progress=rawjson")).length, 1);
	assert(logs.some((line) => line.includes("failed=1 unfinished=0 not_started=1")));
	assert.match(await readFile(summaryFile, "utf8"), /not-started/u);
});

test("build-only without cache configuration stays offline from registry caches", async (t) => {
	const { options } = await fixture(t);
	await buildImages(
		{ ...options, images: ["ops-web"], logger: () => undefined },
		async (_command, args) => {
			assert.equal(
				args.some((arg) => /\.cache-(from|to)=/u.test(arg)),
				false,
			);
			return args.includes("--print") ? bakePrint(["ops-web"]) : result();
		},
	);
});

test("build-only failures preserve completed operations and cache import diagnostics", async (t) => {
	const { options } = await fixture(t);
	const summaryFile = path.join(options.repositoryRoot, "summary.md");
	const buildkit = parseBuildkit(
		`${JSON.stringify({
			vertexes: [
				{
					digest: "import",
					name: "importing cache manifest",
					started: "2026-09-10T00:00:00Z",
					completed: "2026-09-10T00:00:01Z",
					error: "cache not found",
				},
				{
					digest: "install",
					name: "RUN pnpm install",
					started: "2026-09-10T00:00:01Z",
					completed: "2026-09-10T00:00:02Z",
				},
				{
					digest: "build",
					name: "RUN pnpm build",
					started: "2026-09-10T00:00:02Z",
					error: "compile failed",
				},
			],
		})}\n`,
	);
	await assert.rejects(
		buildImages(
			{
				...options,
				summaryFile,
				images: ["ops-web"],
				cacheImportRegistries: ["127.0.0.1:15001/cache"],
				logger: () => undefined,
			},
			async (_command, args) =>
				args.includes("--print") ? bakePrint(["ops-web"]) : result({ code: 1, buildkit }),
		),
		/exit code 1/u,
	);
	const summary = await readFile(summaryFile, "utf8");
	assert.match(summary, /cache not found/u);
	assert.match(summary, /RUN pnpm install \| complete/u);
	assert.match(summary, /compile failed/u);
});
