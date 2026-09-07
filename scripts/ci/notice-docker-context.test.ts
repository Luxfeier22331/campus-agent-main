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
const classifierDockerfile = readFileSync(
	resolve(repositoryRoot, "jobs/notice-classifier/Dockerfile"),
	"utf8",
);
const indexPublisherDockerfile = readFileSync(
	resolve(repositoryRoot, "jobs/notice-index-publisher/Dockerfile"),
	"utf8",
);
const ragPublisherDockerfile = readFileSync(
	resolve(repositoryRoot, "jobs/campus-rag-index-publisher/Dockerfile"),
	"utf8",
);

test("notice database workspace files remain in all ingestion Docker contexts", () => {
	assert.ok(dockerignore.includes("!packages/notice-database/"));
	assert.ok(dockerignore.includes("!packages/notice-database/**"));
});

test("notice index publisher workspace remains in the Docker context", () => {
	assert.ok(dockerignore.includes("!jobs/notice-index-publisher/"));
	assert.ok(dockerignore.includes("!jobs/notice-index-publisher/**"));
});

test("notice images use Turbo prune instead of hand-maintained dependency copies", () => {
	for (const [name, dockerfile] of [
		["publisher", publisherDockerfile],
		["classifier", classifierDockerfile],
		["index-publisher", indexPublisherDockerfile],
	] as const) {
		assert.match(dockerfile, new RegExp(`turbo prune (notice-${name}) --docker`, "u"));
		assert.match(dockerfile, /COPY --from=pruner \/repo\/out\/json\//u);
		assert.match(dockerfile, /COPY --from=pruner \/repo\/out\/full\//u);
		assert.doesNotMatch(dockerfile, /COPY packages\/notice-database\/package\.json/u);
		assert.doesNotMatch(dockerfile, /COPY packages\/notice-database\/src/u);
	}
});

test("Notice index publisher includes the shared embedding runtime source", () => {
	assert.match(
		indexPublisherDockerfile,
		/COPY --from=pruner \/repo\/out\/full\/packages\/embedding-runtime\/src \.\/packages\/embedding-runtime\/src/u,
	);
});

test("Campus RAG publisher includes its workspace and shared embedding runtime source", () => {
	assert.ok(dockerignore.includes("!jobs/campus-rag-index-publisher/"));
	assert.ok(dockerignore.includes("!jobs/campus-rag-index-publisher/**"));
	assert.match(ragPublisherDockerfile, /turbo prune campus-rag-index-publisher --docker/u);
	assert.match(ragPublisherDockerfile, /COPY --from=pruner \/repo\/out\/full\/ \.\//u);
});

test("Collector prunes its workspace dependency closure from the repository context", () => {
	assert.match(collectorDockerfile, /COPY \. \.\n/u);
	assert.match(collectorDockerfile, /turbo prune internal-portal-collection --docker/u);
});

test("Campus Docs publisher includes its shared contract schemas", () => {
	const dockerfile = readFileSync(
		resolve(repositoryRoot, "jobs/campus-docs-index-publisher/Dockerfile"),
		"utf8",
	);
	assert.match(dockerfile, /COPY packages\/contracts\/schemas \.\/packages\/contracts\/schemas/u);
	assert.match(
		dockerfile,
		/COPY --from=pruner \/repo\/out\/full\/packages\/embedding-runtime\/src \.\/packages\/embedding-runtime\/src/u,
	);
});
