import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseAllDocuments } from "yaml";

const manifests = parseAllDocuments(
	readFileSync(new URL("../data-object-store/base/bootstrap.yaml", import.meta.url), "utf8"),
).map((document) => {
	if (document.errors.length > 0) {
		throw new Error(document.errors.map((error) => error.message).join("\n"));
	}
	return document.toJS();
});
const data = manifests.find((manifest) => manifest.kind === "ConfigMap").data;
const job = manifests.find((manifest) => manifest.kind === "Job");
const bucket = "arn:aws:s3:::campus-agent-derived";
const photo = `${bucket}/dining/submissions/submission/photo.webp`;
const sourceBucket = "arn:aws:s3:::campus-agent-source";
const stateKey = `${sourceBucket}/internal_portal/notices/_state.json`;

interface Statement {
	Effect: "Allow" | "Deny";
	Action: string[];
	Resource: string[];
	Condition?: { StringLike: Record<string, string> };
}

// Evaluate the IAM subset used by these policies, including explicit deny and prefix conditions.
// This checks the declared boundary; live RustFS authorization still needs environment acceptance.
function allows(filename: string, action: string, resource: string, prefix?: string): boolean {
	const policy = JSON.parse(data[filename]) as { Statement: Statement[] };
	const matches = policy.Statement.filter((statement) => {
		if (
			!Object.keys(statement).every((key) =>
				["Effect", "Action", "Resource", "Condition"].includes(key),
			)
		) {
			throw new Error("Extend the evaluator before testing a different IAM policy structure");
		}
		if (statement.Condition) {
			if (
				Object.keys(statement.Condition).join() !== "StringLike" ||
				Object.keys(statement.Condition.StringLike).join() !== "s3:prefix"
			) {
				throw new Error("Extend the evaluator before testing different IAM conditions");
			}
			if (prefix === undefined || !match(statement.Condition.StringLike["s3:prefix"], prefix)) {
				return false;
			}
		}
		return (
			statement.Action.some((pattern) => match(pattern, action)) &&
			statement.Resource.some((pattern) => match(pattern, resource))
		);
	});
	return (
		!matches.some((statement) => statement.Effect === "Deny") &&
		matches.some((statement) => statement.Effect === "Allow")
	);
}

function match(pattern: string, value: string): boolean {
	const expression = pattern
		.replace(/[.+^${}()|[\]\\]/gu, "\\$&")
		.replace(/\*/gu, ".*")
		.replace(/\?/gu, ".");
	return new RegExp(`^${expression}$`, "u").test(value);
}

test("Dining writes and version deletion stay inside the submissions prefix", () => {
	for (const action of ["GetObject", "PutObject", "DeleteObject", "DeleteObjectVersion"]) {
		assert.equal(allows("derived-policy.json", `s3:${action}`, photo), true, action);
	}
	for (const action of ["DeleteObject", "DeleteObjectVersion"]) {
		for (const outside of [
			`${bucket}/dining/floorplans/map.svg`,
			`${bucket}/dining/submissions-other/photo.webp`,
			`${bucket}/notices/photo.webp`,
			"arn:aws:s3:::campus-agent-source/dining/submissions/photo.webp",
		]) {
			assert.equal(
				allows("derived-policy.json", `s3:${action}`, outside),
				false,
				`${action}: ${outside}`,
			);
		}
	}
	for (const prefix of ["dining/submissions/", "dining/submissions/submission/photo.webp"]) {
		assert.equal(allows("derived-policy.json", "s3:ListBucketVersions", bucket, prefix), true);
	}
	for (const prefix of [
		undefined,
		"",
		"dining/",
		"dining/submissions",
		"dining/submissions-other/",
	]) {
		assert.equal(allows("derived-policy.json", "s3:ListBucketVersions", bucket, prefix), false);
	}
	assert.equal(
		allows(
			"derived-policy.json",
			"s3:ListBucketVersions",
			"arn:aws:s3:::campus-agent-source",
			"dining/submissions/",
		),
		false,
	);
	assert.equal(allows("derived-policy.json", "s3:GetObjectVersion", photo), false);
});

test("Dining Ops reads submissions through the derived read identity without mutation rights", () => {
	assert.equal(allows("derived-read-policy.json", "s3:GetObject", photo), true);
	assert.equal(allows("derived-read-policy.json", "s3:GetObjectVersion", photo), true);
	assert.equal(
		allows("derived-read-policy.json", "s3:GetObject", `${bucket}/notices/photo.webp`),
		true,
	);
	for (const action of ["PutObject", "DeleteObject", "DeleteObjectVersion"]) {
		assert.equal(allows("derived-read-policy.json", `s3:${action}`, photo), false, action);
	}
	for (const action of ["ListBucketVersions"]) {
		assert.equal(
			allows("derived-read-policy.json", `s3:${action}`, bucket, "dining/submissions/"),
			false,
			action,
		);
	}
});

test("bootstrap provisions source, derived and backup identities without dining-specific policies", () => {
	const directory = mkdtempSync(join(tmpdir(), "derived-bootstrap-test-"));
	try {
		const callsPath = join(directory, "calls.jsonl");
		writeFileSync(
			join(directory, "rc"),
			`#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.DERIVED_TEST_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');\n`,
			{ mode: 0o700 },
		);
		const env: NodeJS.ProcessEnv = {
			PATH: `${directory}:${process.env.PATH}`,
			DERIVED_TEST_CALLS: callsPath,
		};
		for (const entry of job.spec.template.spec.containers[0].env) {
			if (entry.valueFrom?.secretKeyRef) {
				env[entry.name] = `test-${entry.name}`;
			}
		}
		const envNames = job.spec.template.spec.containers[0].env.map(
			(entry: { name: string }) => entry.name,
		);
		for (const name of envNames.filter((name: string) => name.startsWith("OBJECT_STORE_"))) {
			const entry = job.spec.template.spec.containers[0].env.find(
				(item: { name: string }) => item.name === name,
			);
			assert.deepEqual(entry?.valueFrom?.secretKeyRef, { name: "object-store-secrets", key: name });
		}
		assert.equal(envNames.includes("OBJECT_STORE_DINING_ACCESS_KEY"), false);
		assert.equal(envNames.includes("OBJECT_STORE_DINING_SECRET_KEY"), false);
		assert.equal(envNames.includes("OBJECT_STORE_DINING_READ_ACCESS_KEY"), false);
		assert.equal(envNames.includes("OBJECT_STORE_DINING_READ_SECRET_KEY"), false);
		assert.equal(data["dining-policy.json"], undefined);
		assert.equal(data["dining-read-policy.json"], undefined);
		execFileSync("/bin/sh", ["-c", data["bootstrap.sh"]], { env });
		const calls = readFileSync(callsPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as string[]);
		const createdPolicies = calls
			.filter((call) => call[0] === "admin" && call[2] === "create")
			.map((call) => call[4]);
		assert.deepEqual(createdPolicies, [
			"campus-agent-source-rw",
			"campus-agent-derived-rw",
			"campus-agent-derived-ro",
			"campus-agent-source-ro",
			"campus-agent-postgres-backup-rw",
		]);
		for (const [policy, suffix] of [
			["campus-agent-derived-rw", ""],
			["campus-agent-derived-ro", "READ_"],
		]) {
			const accessKey = env[`OBJECT_STORE_DERIVED_${suffix}ACCESS_KEY`];
			const secretKey = env[`OBJECT_STORE_DERIVED_${suffix}SECRET_KEY`];
			assert.ok(
				calls.some(
					(call) =>
						JSON.stringify(call) ===
						JSON.stringify(["admin", "user", "add", "object-store", accessKey, secretKey]),
				),
			);
			const attachments = calls.filter(
				(call) =>
					call[0] === "admin" &&
					call[1] === "policy" &&
					call[2] === "attach" &&
					call[6] === accessKey,
			);
			assert.deepEqual(attachments, [
				["admin", "policy", "attach", "object-store", policy, "--user", accessKey],
			]);
		}
		assert.equal(
			calls.some((call) => call.some((argument) => String(argument).includes("dining"))),
			false,
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("automatic Notice RAG cleanup can remove versioned artifacts while caches and sources stay protected", () => {
	for (const prefix of ["chunk-runs", "chunk-data", "embedding-data", "embedding-sets"]) {
		const key = `notices/rag/${prefix}/sha256/id/manifest.json`;
		assert(allows("derived-policy.json", "s3:ListBucketVersions", bucket, key));
		for (const action of ["DeleteObject", "DeleteObjectVersion"]) {
			assert(allows("derived-policy.json", `s3:${action}`, `${bucket}/${key}`));
		}
	}
	for (const key of [
		"notices/rag/embedding-cache/cache.json",
		"notices/assets/sha256/file",
		"docs/rag/manifest.json",
	]) {
		assert.equal(allows("derived-policy.json", "s3:ListBucketVersions", bucket, key), false);
		assert.equal(
			allows("derived-policy.json", "s3:DeleteObjectVersion", `${bucket}/${key}`),
			false,
		);
	}
});

test("source writer can clean only the mutable notice state object", () => {
	assert.equal(
		allows(
			"source-policy.json",
			"s3:ListBucketVersions",
			sourceBucket,
			"internal_portal/notices/_state.json",
		),
		true,
	);
	for (const action of ["GetObjectVersion", "DeleteObject", "DeleteObjectVersion"]) {
		assert.equal(allows("source-policy.json", `s3:${action}`, stateKey), true, action);
		assert.equal(
			allows(
				"source-policy.json",
				`s3:${action}`,
				`${sourceBucket}/internal_portal/notices/other.json`,
			),
			false,
			`${action}: other state key`,
		);
	}
	for (const prefix of [undefined, "internal_portal/", "internal_portal/notices/"]) {
		assert.equal(
			allows("source-policy.json", "s3:ListBucketVersions", sourceBucket, prefix),
			false,
			`ListBucketVersions: ${prefix ?? "missing prefix"}`,
		);
	}
});
