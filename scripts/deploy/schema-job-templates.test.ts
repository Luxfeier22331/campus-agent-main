import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { parseAllDocuments } from "yaml";

type JsonObject = Record<string, unknown>;

const base = resolve(import.meta.dirname, "../../infra/k8s/data-postgres/base");

test("the unified schema Job uses the shared database owner and CA", () => {
	const manifest = singleManifest(resolve(base, "schema-job.yaml"));
	assert.equal(manifest.kind, "Job");
	assert.equal(nameOf(manifest), "campus-agent-schema");
	const spec = record(manifest.spec, "Job spec");
	assert.equal(spec.activeDeadlineSeconds, 300);
	assert.equal(spec.backoffLimit, 0);
	const podSpec = record(record(spec.template, "pod template").spec, "pod spec");
	const containers = podSpec.containers;
	assert.ok(Array.isArray(containers) && containers.length === 1);
	const schemaContainer = record(containers[0], "schema container");
	assert.equal(
		schemaContainer.image,
		"ghcr.io/muc-wiki/campus-agent/campus-agent-schema:replace-me",
	);
	assert.deepEqual(schemaContainer.args, ["migrate"]);
	assert.deepEqual(schemaContainer.envFrom, [
		{ configMapRef: { name: "campus-agent-database-config" } },
	]);
	assert.deepEqual(secretNames(schemaContainer), [
		"campus-agent-postgres-campus-agent-owner",
		"campus-agent-postgres-campus-agent-owner",
	]);
	const volumes = podSpec.volumes;
	assert.ok(Array.isArray(volumes));
	assert.ok(
		volumes.some(
			(volume) =>
				record(volume, "volume").secret?.secretName === "campus-agent-postgres-origin-server",
		),
	);
});

test("the shared database ConfigMap serves schema and notice runtimes", () => {
	const manifest = singleManifest(resolve(base, "database-config.yaml"));
	assert.equal(nameOf(manifest), "campus-agent-database-config");
	assert.deepEqual(manifest.data, {
		PGHOST: "postgres.example.invalid",
		PGPORT: "5432",
		PGDATABASE: "campus_agent",
		PGSSLMODE: "verify-full",
		PGSSLROOTCERT: "/etc/campus-agent/postgres/ca.crt",
		NOTICES_DATABASE_SSLMODE: "verify-full",
		NOTICES_DATABASE_CA_CERT_PATH: "/etc/campus-agent/postgres/ca.crt",
	});
});

function singleManifest(path: string): JsonObject {
	const values = parseAllDocuments(readFileSync(path, "utf8")).map((document) => document.toJS());
	if (
		values.length !== 1 ||
		!values[0] ||
		typeof values[0] !== "object" ||
		Array.isArray(values[0])
	) {
		throw new Error(`${path} must contain exactly one manifest`);
	}
	return values[0] as JsonObject;
}

function nameOf(manifest: JsonObject): string {
	const name = record(manifest.metadata, "metadata").name;
	if (typeof name !== "string") {
		throw new Error("manifest name is invalid");
	}
	return name;
}

function secretNames(container: JsonObject): string[] {
	if (!Array.isArray(container.env)) {
		throw new Error("container env is invalid");
	}
	return container.env.flatMap((item: unknown) => {
		const valueFrom = objectProperty(record(item, "env item"), "valueFrom");
		if (!isObject(valueFrom)) {
			return [];
		}
		const secretKeyRef = objectProperty(valueFrom, "secretKeyRef");
		if (!isObject(secretKeyRef)) {
			return [];
		}
		const name = secretKeyRef.name;
		return typeof name === "string" ? [name] : [];
	});
}

function record(value: unknown, label: string): JsonObject {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} is invalid`);
	}
	return value as JsonObject;
}

function objectProperty(value: JsonObject, key: string): unknown {
	return value[key];
}

function isObject(value: unknown): value is JsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
