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

async function runProbe(options: { architecture: string }): Promise<{
	status: number;
	stdout: string;
	stderr: string;
}> {
	const root = await mkdtemp(path.join(os.tmpdir(), "campus-agent-runner-probe-test-"));
	const bin = path.join(root, "bin");
	await mkdir(bin);
	const fixture = await createOciFixture(root, options.architecture);
	const fakeDocker = path.join(bin, "docker");
	await writeFile(
		fakeDocker,
		`#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  info) exit 0 ;;
  buildx)
    case "\${2:-}" in
      inspect) exit 0 ;;
      ls)
        printf '%s\\n' "{\\"Name\\":\\"campus-agent-release\\",\\"Nodes\\":[{\\"Status\\":\\"running\\",\\"Platforms\\":[\\"linux/arm64\\"]}]}"
        printf '%s\\n' "{\\"Name\\":\\"campus-agent-release\\",\\"Nodes\\":[{\\"Status\\":\\"running\\",\\"Platforms\\":[\\"linux/arm64\\"]}]}"
        exit 0
        ;;
      build)
        output=""
        previous=""
        for argument in "$@"; do
          if [[ "$previous" == --output ]]; then output="$argument"; fi
          previous="$argument"
        done
        destination="\${output##*dest=}"
        cp "\${PROBE_FIXTURE}" "\${destination}"
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

test("runner capability probe rejects a non-arm64 OCI result", async () => {
	const result = await runProbe({ architecture: "amd64" });
	assert.notEqual(result.status, 0);
});
