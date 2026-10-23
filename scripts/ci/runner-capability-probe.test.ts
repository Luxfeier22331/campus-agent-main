import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");
const PROBE = path.join(REPOSITORY_ROOT, "scripts/ci/runner-capability-probe.sh");

async function createOciFixture(root: string, architecture: string): Promise<string> {
	const source = path.join(root, "oci");
	await mkdir(source);
	await writeFile(
		path.join(source, "index.json"),
		JSON.stringify({
			schemaVersion: 2,
			manifests: [
				{
					platform: { architecture, os: "linux" },
				},
			],
		}),
	);
	const fixture = path.join(root, "probe.tar");
	await execFileAsync("tar", ["-cf", fixture, "-C", source, "index.json"]);
	return fixture;
}

async function runProbe(options: {
	architecture: string;
	driver?: string;
	skipCache?: boolean;
	config?: string | null;
}): Promise<{
	status: number;
	stdout: string;
	stderr: string;
}> {
	const root = await mkdtemp(path.join(os.tmpdir(), "campus-agent-runner-probe-test-"));
	const bin = path.join(root, "bin");
	await mkdir(bin);
	const fixture = await createOciFixture(root, options.architecture);
	const fakeDocker = path.join(bin, "docker");
	const fakeDf = path.join(bin, "df");
	const builder = JSON.stringify({
		Name: "campus-agent-release",
		Driver: options.driver ?? "docker-container",
		Nodes: [
			{
				Name: "campus-agent-release0",
				Status: "running",
				Platforms: ["linux/arm64"],
				Files:
					options.config === null
						? {}
						: {
								"buildkitd.toml": Buffer.from(
									options.config ?? "[worker.oci]\nmax-parallelism = 2\n",
								).toString("base64"),
							},
			},
		],
	});
	await writeFile(
		fakeDf,
		`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "Filesystem 1B-blocks Used Available Use% Mounted on"
printf '%s\\n' "fixture 100000000000 1000000000 50000000000 1% /"
`,
	);
	await chmod(fakeDf, 0o755);
	await writeFile(
		fakeDocker,
		`#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  version) exit 0 ;;
  buildx)
    case "\${2:-}" in
      inspect) exit 0 ;;
      ls)
        printf '%s\\n' '${builder}' '${builder}'
        exit 0
        ;;
      build)
        output=""
        cache=""
        previous=""
        for argument in "$@"; do
          if [[ "$previous" == --output ]]; then output="$argument"; fi
          if [[ "$previous" == --cache-to ]]; then cache="$argument"; fi
          previous="$argument"
        done
        destination="\${output##*dest=}"
        cp "\${PROBE_FIXTURE}" "\${destination}"
        if [[ "\${PROBE_SKIP_CACHE:-false}" == true ]]; then exit 0; fi
        cache_destination="\${cache#*dest=}"
        cache_destination="\${cache_destination%%,*}"
        mkdir -p "$cache_destination"
        printf '{"schemaVersion":2}\\n' > "$cache_destination/index.json"
        exit 0
        ;;
    esac
    ;;
esac
exit 1
`,
	);
	await chmod(fakeDocker, 0o755);
	try {
		const result = await execFileAsync("bash", [PROBE], {
			env: {
				...process.env,
				BUILDX_BUILDER: "campus-agent-release",
				PATH: `${bin}:${process.env.PATH ?? ""}`,
				PROBE_FIXTURE: fixture,
				PROBE_SKIP_CACHE: String(options.skipCache ?? false),
			},
			maxBuffer: 4 * 1024 * 1024,
		});
		return { status: 0, stdout: result.stdout, stderr: result.stderr };
	} catch (error) {
		const failure = error as { code?: number; stdout?: string; stderr?: string };
		return {
			status: typeof failure.code === "number" ? failure.code : 1,
			stdout: failure.stdout ?? "",
			stderr: failure.stderr ?? "",
		};
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("runner capability probe accepts an arm64 builder and OCI result", async () => {
	const result = await runProbe({ architecture: "arm64" });
	assert.equal(result.status, 0, String(result.stderr));
	assert.match(String(result.stdout), /linux\/arm64/u);
});

test("runner capability probe rejects missing or ineffective concurrency limits", async () => {
	for (const config of [
		null,
		"[worker.oci]\ngc = true\n",
		"[worker.oci]\nmax-parallelism = 0\n",
		"[worker.oci]\nmax-parallelism = 4\n",
		"[worker.oci]\n# max-parallelism = 2\n",
		"[worker.oci]\ngc = true\n[worker.containerd]\nmax-parallelism = 2\n",
	]) {
		const result = await runProbe({ architecture: "arm64", config });
		assert.notEqual(result.status, 0, `accepted ${config}`);
		assert.match(result.stderr, /buildkitd\.toml|max-parallelism = 2/u);
	}
});

test("runner capability probe accepts spacing and comments in the OCI configuration", async () => {
	const result = await runProbe({
		architecture: "arm64",
		config: "[worker.oci] # native worker\n  max-parallelism=2 # bounded\n[registry]\n",
	});
	assert.equal(result.status, 0, result.stderr);
});

test("runner capability probe rejects a non-arm64 OCI result", async () => {
	const result = await runProbe({ architecture: "amd64" });
	assert.notEqual(result.status, 0);
});

test("runner capability probe rejects an unsupported driver and missing cache export", async () => {
	for (const options of [{ driver: "docker" }, { skipCache: true }]) {
		const result = await runProbe({ architecture: "arm64", ...options });
		assert.notEqual(result.status, 0);
	}
});
