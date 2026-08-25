import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const dockerignore = readFileSync(resolve(repositoryRoot, ".dockerignore"), "utf8").split("\n");

const publisherDockerfile = readFileSync(
	resolve(repositoryRoot, "jobs/notice-publisher/Dockerfile"),
	"utf8",
);
const collectorDockerfile = readFileSync(
	resolve(repositoryRoot, "jobs/internal-portal-collection/Dockerfile"),
	"utf8",
);

test("notice database workspace files remain in all ingestion Docker contexts", () => {
	assert.ok(dockerignore.includes("!packages/notice-database/"));
	assert.ok(dockerignore.includes("!packages/notice-database/**"));
});

test("Publisher copies the notice database manifest and source at the required stages", () => {
	const manifest =
		"COPY packages/notice-database/package.json ./packages/notice-database/package.json";
	const install = "pnpm install --frozen-lockfile --filter notice-publisher...";
	const productionInstall = "pnpm install --prod --frozen-lockfile --filter notice-publisher...";
	const source = "COPY packages/notice-database/src ./packages/notice-database/src";
	const build = "pnpm --filter notice-publisher build";

	assert.equal(publisherDockerfile.split(manifest).length - 1, 2);
	assert.ok(publisherDockerfile.indexOf(manifest) < publisherDockerfile.indexOf(install));
	assert.ok(
		publisherDockerfile.lastIndexOf(manifest) < publisherDockerfile.indexOf(productionInstall),
	);
	assert.ok(publisherDockerfile.indexOf(source) < publisherDockerfile.indexOf(build));
});

test("Collector prunes its workspace dependency closure from the repository context", () => {
	assert.match(collectorDockerfile, /COPY \. \.\n/u);
	assert.match(collectorDockerfile, /turbo prune internal-portal-collection --docker/u);
});
