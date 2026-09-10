import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { parseBuildkit } from "../release/buildkit-progress.mts";

export function localRegistry(ref: string) {
	if (!/^127\.0\.0\.1:\d+\/[a-z0-9][a-z0-9/._-]*:[a-zA-Z0-9._-]+$/u.test(ref)) {
		throw new Error("Measurement output must use 127.0.0.1:<port>/<repository>:<tag>");
	}
	const [host, ...parts] = ref.split("/");
	const [repository, tag] = parts.join("/").split(":");
	return { host, repository, tag };
}

async function main() {
	const { values } = parseArgs({
		options: {
			builder: { type: "string" },
			context: { type: "string", default: "." },
			target: { type: "string", default: "ops-web" },
			platform: { type: "string", default: "linux/arm64" },
			"cache-ref": { type: "string" },
			"image-ref": { type: "string" },
			"import-cache": { type: "boolean", default: false },
			output: { type: "string" },
		},
	});
	if (!(values.builder && values.output && values["cache-ref"] && values["image-ref"])) {
		throw new Error("Required: --builder --cache-ref --image-ref --output (new directory)");
	}
	const cache = localRegistry(values["cache-ref"]);
	localRegistry(values["image-ref"]);
	const output = path.resolve(values.output);
	mkdirSync(output, { recursive: false });
	const target = values.target;
	const args = [
		"buildx",
		"bake",
		"--builder",
		values.builder,
		"--file",
		"docker-bake.hcl",
		"--progress",
		"rawjson",
		"--metadata-file",
		path.join(output, "metadata.json"),
		"--set",
		`${target}.platform=${values.platform}`,
		"--set",
		`${target}.tags=${values["image-ref"]}`,
		"--set",
		`${target}.cache-to=type=registry,ref=${values["cache-ref"]},mode=max`,
		"--set",
		`${target}.output=type=registry`,
	];
	if (values["import-cache"]) {
		args.push("--set", `${target}.cache-from=type=registry,ref=${values["cache-ref"]}`);
	}
	// Use the caller's Docker proxy configuration, without putting credentials in the report.
	for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"]) {
		if (process.env[name]) {
			args.push("--set", `${target}.args.${name}=${process.env[name]}`);
		}
	}
	args.push(target);
	const logPath = path.join(output, "buildkit.jsonl");
	const log = openSync(logPath, "w");
	const start = performance.now();
	let result: ReturnType<typeof spawnSync>;
	try {
		result = spawnSync("docker", args, {
			cwd: path.resolve(values.context),
			stdio: ["ignore", log, log],
		});
	} finally {
		closeSync(log);
	}
	const wallMs = performance.now() - start;
	let cacheBytes: number | null = null;
	let cacheError: string | undefined;
	if (result.status === 0) {
		try {
			const response = await fetch(
				`http://${cache.host}/v2/${cache.repository}/manifests/${cache.tag}`,
				{
					headers: { Accept: "application/vnd.oci.image.manifest.v1+json" },
					signal: AbortSignal.timeout(10_000),
				},
			);
			if (!response.ok) {
				throw new Error(`Registry returned ${response.status}`);
			}
			const manifest = await response.json();
			if (!Array.isArray(manifest.layers)) {
				throw new Error("Expected cache image manifest with layers");
			}
			cacheBytes = manifest.layers.reduce(
				(sum: number, layer: { size: number }) => sum + layer.size,
				0,
			);
		} catch (error) {
			cacheError = String(error);
		}
	}
	const report = {
		target,
		platform: values.platform,
		wallMs,
		exitCode: result.status,
		signal: result.signal,
		error: result.error?.message,
		cacheBytes,
		cacheError,
		buildkit: parseBuildkit(readFileSync(logPath, "utf8")),
		notes: [
			"Vertex durations overlap and must not be summed as build wall time.",
			"Cache bytes are compressed layers referenced by the manifest, not bytes uploaded this run.",
			"Local loopback transfer and emulation do not predict hosted ARM runner or GHCR performance.",
		],
	};
	writeFileSync(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(
		`${JSON.stringify({ output, wallMs, exitCode: result.status, cacheBytes })}\n`,
	);
	process.exitCode = result.status === 0 && !cacheError ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((error) => {
		process.stderr.write(`${String(error)}\n`);
		process.exitCode = 1;
	});
}
