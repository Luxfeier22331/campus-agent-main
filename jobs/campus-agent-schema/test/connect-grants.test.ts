import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseAllDocuments } from "yaml";

const repositoryRoot = resolve(import.meta.dirname, "..", "..", "..");
const migrationsFolder = resolve(import.meta.dirname, "..", "migrations");
const localRolesFile = resolve(repositoryRoot, "scripts/dev/lifecycle/database-roles.ts");
// Role identities come from CNPG DatabaseRole; database CONNECT comes from migrations.
const rolesProvisionedOutsideCampusAgentDatabase = new Set([
	"temporal",
	"hindsight",
	"hindsight_ro",
	"memory_service",
]);
// Documented consumers that reuse another login identity instead of owning one.
const consumersSharingAnotherIdentity = new Map([["notice_publisher", "campus_agent"]]);
const nonCampusAgentIdentities = new Set([
	...rolesProvisionedOutsideCampusAgentDatabase,
	...consumersSharingAnotherIdentity.keys(),
]);

async function loginRoles(): Promise<Set<string>> {
	const names = new Set<string>();
	for (const path of await yamlFiles(resolve(repositoryRoot, "infra/k8s"))) {
		for (const document of parseAllDocuments(await readFile(path, "utf8"))) {
			const manifest = document.toJS() as {
				kind?: string;
				spec?: { name?: string; login?: boolean };
			} | null;
			if (manifest?.kind !== "DatabaseRole") {
				continue;
			}
			const roleName = manifest.spec?.name;
			if (typeof roleName !== "string") {
				throw new Error(`${path} DatabaseRole is missing spec.name`);
			}
			names.add(roleName);
		}
	}
	return names;
}

async function yamlFiles(root: string): Promise<string[]> {
	const paths: string[] = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			paths.push(...(await yamlFiles(path)));
		} else if (entry.name.endsWith(".yaml")) {
			paths.push(path);
		}
	}
	return paths;
}

async function migrationConnectTargets(): Promise<Map<string, string>> {
	const targets = new Map<string, string>();
	for (const directory of await readdir(migrationsFolder)) {
		const path = join(migrationsFolder, directory, "migration.sql");
		let sql: string;
		try {
			sql = await readFile(path, "utf8");
		} catch {
			continue;
		}
		for (const match of sql.matchAll(/GRANT CONNECT ON DATABASE %I TO ([a-z_]+)/gu)) {
			targets.set(match[1] as string, directory);
		}
	}
	return targets;
}

async function documentedConsumers(): Promise<string[]> {
	const markdown = await readFile(
		resolve(repositoryRoot, "docs/data/postgres-ownership.md"),
		"utf8",
	);
	const table = markdown.slice(
		markdown.indexOf("| 角色 | 运行所有者 |"),
		markdown.indexOf("Temporal、Hindsight"),
	);
	return [...table.matchAll(/^\| `([a-z_]+)` \|/gmu)].map((match) => match[1] as string);
}

test("every campus_agent consumer gets CONNECT from a migration", async () => {
	const consumers = (await documentedConsumers()).filter(
		(name) => !rolesProvisionedOutsideCampusAgentDatabase.has(name),
	);
	const targets = await migrationConnectTargets();
	for (const consumer of consumers) {
		const identity = consumersSharingAnotherIdentity.get(consumer);
		const grantedIdentity = identity ?? consumer;
		assert.ok(
			targets.has(grantedIdentity),
			`${consumer} consumes campus_agent as ${grantedIdentity} but no migration grants CONNECT`,
		);
	}
});

test("CONNECT grants cover every login role provisioned for campus_agent", async () => {
	const roles = await loginRoles();
	const targets = await migrationConnectTargets();
	const expected = [...roles].filter((name) => !nonCampusAgentIdentities.has(name));
	assert.deepEqual(
		expected.slice().sort(),
		[...targets.keys()].sort(),
		"login roles provisioned for campus_agent and migration CONNECT targets must match",
	);
});

test("local dev leaves product CONNECT to the migrations", async () => {
	const source = await readFile(localRolesFile, "utf8");
	const granted = [...source.matchAll(/GRANT CONNECT ON DATABASE [^`]*? TO ([a-z_]+)/gu)].map(
		(match) => match[1] as string,
	);
	// notice_publisher is local-only; every product consumer is granted by a migration.
	assert.deepEqual(granted, ["notice_publisher"]);
});
