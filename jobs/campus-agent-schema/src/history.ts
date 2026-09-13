import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";

export type Migration = ReturnType<typeof readMigrationFiles>[number] & { name: string };
export interface AppliedMigration {
	id: number;
	hash: string;
	created_at: string;
	name?: string | null;
}

export function readHistory(folder: string): Migration[] {
	const entries = readdirSync(folder, { withFileTypes: true });
	for (const entry of entries) {
		if (!(entry.isDirectory() && /^\d{14}_[a-z0-9_]+$/u.test(entry.name))) {
			throw new Error(`Invalid migration entry: ${entry.name}`);
		}
		const files = readdirSync(join(folder, entry.name));
		if (!files.includes("migration.sql")) {
			throw new Error(`Missing SQL: ${entry.name}`);
		}
	}
	const migrations = readMigrationFiles({ migrationsFolder: folder }) as Migration[];
	if (migrations.length === 0) {
		throw new Error("Migration history is empty");
	}
	for (const migration of migrations) {
		if (!Number.isFinite(migration.folderMillis)) {
			throw new Error(`Invalid migration date: ${migration.name}`);
		}
	}
	return migrations;
}

export function compareHistory(
	local: Migration[],
	applied: AppliedMigration[],
	named: boolean,
): string[] {
	const matched = new Set<string>();
	for (const row of applied) {
		const candidates = local.filter((migration) =>
			named ? migration.name === row.name : migration.hash === row.hash,
		);
		const migration = candidates[0];
		if (candidates.length !== 1 || !migration) {
			throw new Error(`Unknown or ambiguous applied migration: ${row.name ?? row.id}`);
		}
		if (migration.hash !== row.hash) {
			throw new Error(`Applied migration SQL changed: ${migration.name}`);
		}
		if (matched.has(migration.name)) {
			throw new Error(`Duplicate applied migration: ${migration.name}`);
		}
		// v1 upgrades v0 names by second-resolution timestamps, falling back to hashes.
		// Confirm its match is the same before it changes the ledger or executes SQL.
		if (!named) {
			const at = Math.floor(Number(row.created_at) / 1000) * 1000;
			const sameTime = local.filter((item) => item.folderMillis === at);
			const nativeMatch =
				sameTime.length === 1
					? sameTime[0]
					: sameTime.length > 1
						? sameTime.find((item) => item.hash === row.hash)
						: migration;
			if (nativeMatch?.name !== migration.name) {
				throw new Error(`Legacy migration mapping conflict: ${row.id}`);
			}
		}
		matched.add(migration.name);
	}
	return local
		.filter((migration) => !matched.has(migration.name))
		.map((migration) => migration.name);
}

export function createMigration(folder: string, description: string, now = new Date()): string {
	if (!/^[a-z][a-z0-9_]*$/u.test(description)) {
		throw new Error("Migration name must use lowercase letters, digits and underscores");
	}
	const stamp = now.toISOString().replace(/[-:]/gu, "").replace("T", "").slice(0, 14);
	const directory = join(folder, `${stamp}_${description}`);
	mkdirSync(directory);
	const path = join(directory, "migration.sql");
	writeFileSync(path, "-- Write the reviewed SQL migration here.\n", { flag: "wx" });
	return path;
}
