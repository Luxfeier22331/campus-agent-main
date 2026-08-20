import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { parseAllDocuments } from "yaml";

import {
	collectionJobTemplate,
	parseInternalPortalCollectionJobInput,
} from "./internal-portal-collection-job.ts";

const manifestPath = resolve(
	import.meta.dirname,
	"../../infra/k8s/ingestion-runtime/base/runtime/internal-portal-collection.yaml",
);

test("maps notice sync to the shared suspended template", () => {
	const input = parseInternalPortalCollectionJobInput([
		"--",
		"--namespace",
		"campus-agent-staging",
		"--mode",
		"notice-sync",
	]);
	assert.deepEqual(collectionJobTemplate(input), {
		args: ["--mode", "notice-sync"],
		cronJob: "internal-portal-collection",
		jobPrefix: "internal-portal-notice-sync",
	});
});

test("requires a valid start date only for notice backfill", () => {
	assert.throws(
		() =>
			parseInternalPortalCollectionJobInput([
				"--namespace",
				"campus-agent-staging",
				"--mode",
				"notice-backfill",
			]),
		/Usage:/u,
	);
	const input = parseInternalPortalCollectionJobInput([
		"--namespace",
		"campus-agent-staging",
		"--mode",
		"notice-backfill",
		"--start-date",
		"2026-08-01",
	]);
	assert.deepEqual(collectionJobTemplate(input), {
		args: ["--mode", "notice-backfill", "--start-date", "2026-08-01"],
		cronJob: "internal-portal-collection",
		jobPrefix: "internal-portal-notice-backfill",
	});
});

test("maps file sync without notice-only parameters", () => {
	const input = parseInternalPortalCollectionJobInput([
		"--namespace",
		"campus-agent-staging",
		"--mode",
		"file-sync",
	]);
	assert.deepEqual(collectionJobTemplate(input), {
		args: ["--mode", "file-sync"],
		cronJob: "internal-portal-collection",
		jobPrefix: "internal-portal-file-sync",
	});
	assert.throws(
		() =>
			parseInternalPortalCollectionJobInput([
				"--namespace",
				"campus-agent-staging",
				"--mode",
				"file-sync",
				"--concurrency",
				"2",
			]),
		/Usage:/u,
	);
});

test("keeps one collection template suspended and non-retrying", () => {
	const manifests = parseAllDocuments(readFileSync(manifestPath, "utf8")).map((document) =>
		record(document.toJS(), "manifest"),
	);
	assert.equal(manifests.length, 1);
	const manifest = manifests[0] as Record<string, unknown>;
	const metadata = record(manifest.metadata, "metadata");
	assert.equal(metadata.name, "internal-portal-collection");
	const spec = record(manifest.spec, "CronJob spec");
	assert.equal(spec.suspend, true);
	const jobTemplate = record(spec.jobTemplate, "job template");
	const jobSpec = record(jobTemplate.spec, "Job spec");
	assert.equal(jobSpec.backoffLimit, 0);
	assert.deepEqual(container(manifest).args, ["--mode", "notice-sync"]);
});

function container(manifest: Record<string, unknown>): Record<string, unknown> {
	const spec = record(manifest.spec, "CronJob spec");
	const jobTemplate = record(spec.jobTemplate, "job template");
	const jobSpec = record(jobTemplate.spec, "Job spec");
	const template = record(jobSpec.template, "pod template");
	const podSpec = record(template.spec, "pod spec");
	if (!Array.isArray(podSpec.containers) || podSpec.containers.length !== 1) {
		throw new Error("internal-portal-collection must contain one container");
	}
	return record(podSpec.containers[0], "container");
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} is invalid`);
	}
	return value as Record<string, unknown>;
}
