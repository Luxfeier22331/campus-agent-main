import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const nodeDockerfiles = [
	"apps/agent-runtime/Dockerfile",
	"apps/ops-web/Dockerfile",
	"jobs/campus-agent-schema/Dockerfile",
	"jobs/campus-docs-index-publisher/Dockerfile",
	"jobs/campus-rag-index-publisher/Dockerfile",
	"jobs/internal-portal-collection/Dockerfile",
	"jobs/notice-classifier/Dockerfile",
	"jobs/notice-index-publisher/Dockerfile",
	"jobs/notice-publisher/Dockerfile",
] as const;

const nodeVersion = readFileSync(resolve(repositoryRoot, ".node-version"), "utf8").trim();

test("Node image pruners invoke the installed Turbo binary", () => {
	for (const file of nodeDockerfiles) {
		const dockerfile = readFileSync(resolve(repositoryRoot, file), "utf8");
		assert.match(dockerfile, /RUN \.\/node_modules\/\.bin\/turbo prune [^\n]+ --docker/u, file);
		assert.doesNotMatch(dockerfile, /pnpm exec turbo prune/u, file);
	}
});

test("Node image installs do not execute workspace lifecycle scripts", () => {
	for (const file of nodeDockerfiles) {
		const dockerfile = readFileSync(resolve(repositoryRoot, file), "utf8");
		const installLines = dockerfile.split("\n").filter((line) => /\bpnpm install\b/u.test(line));
		assert.ok(installLines.length > 0, `${file} must install dependencies`);
		for (const line of installLines) {
			assert.match(line, /--ignore-scripts/u, `${file} must skip lifecycle scripts`);
		}
	}
});

test("Node image deploys do not execute workspace lifecycle scripts", () => {
	const dockerfile = readFileSync(resolve(repositoryRoot, "apps/ops-web/Dockerfile"), "utf8");
	const deployLines = dockerfile.split("\n").filter((line) => /\bpnpm .*deploy\b/u.test(line));
	assert.equal(deployLines.length, 1, "Ops Web must have one production deploy command");
	assert.match(deployLines[0], /PNPM_CONFIG_IGNORE_SCRIPTS=true/u);
});

test("Ops Web pnpm commands mount the configured store and Corepack cache", () => {
	const dockerfile = readFileSync(resolve(repositoryRoot, "apps/ops-web/Dockerfile"), "utf8");
	const pnpmHome = dockerfile.match(/^ENV PNPM_HOME=(.+)$/mu)?.[1];
	assert.equal(pnpmHome, "/pnpm");
	const commands = dockerfile.replaceAll("\\\n", " ").split("\n");
	const pnpmCommands = commands.filter(
		(line) => line.startsWith("RUN ") && /\bpnpm (?:install|--filter)/u.test(line),
	);
	assert.equal(pnpmCommands.length, 3);
	for (const command of pnpmCommands) {
		assert(command.includes(`id=pnpm-store,target=${pnpmHome}/store,sharing=locked`));
		assert(command.includes("id=corepack,target=/root/.cache/node/corepack,sharing=locked"));
	}
});

test("Node image defaults follow the repository Node version", () => {
	const bake = readFileSync(resolve(repositoryRoot, "docker-bake.hcl"), "utf8");
	const bakeVersion = bake.match(/variable "NODE_VERSION" \{\s*default = "([^"]+)"\s*\}/u)?.[1];
	assert.equal(bakeVersion, nodeVersion, "Docker Bake default must match .node-version");

	for (const file of nodeDockerfiles) {
		const dockerfile = readFileSync(resolve(repositoryRoot, file), "utf8");
		const dockerVersion = dockerfile.match(/^ARG NODE_VERSION=([^\s]+)$/mu)?.[1];
		assert.equal(dockerVersion, nodeVersion, `${file} default must match .node-version`);
	}
});
