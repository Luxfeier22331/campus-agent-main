import process from "node:process";
import pg from "pg";
import { loadMigrationContext } from "./adopt-shared-database-context.mjs";
import {
	inspectSharedDatabase,
	readDatabaseInventory,
} from "./adopt-shared-database-inventory.mjs";
import { buildAdoptionPlan } from "./adopt-shared-database-plan.mjs";
import {
	APP_API_MIGRATIONS_SCHEMA,
	APP_API_MIGRATIONS_TABLE,
	quoteIdentifier,
} from "./adopt-shared-database-shared.mjs";

async function ensureMigrationJournal(client) {
	await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(APP_API_MIGRATIONS_SCHEMA)}`);
	await client.query(
		`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(APP_API_MIGRATIONS_SCHEMA)}.${quoteIdentifier(APP_API_MIGRATIONS_TABLE)} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`,
	);
}

export async function applyAdoptionPlan({ client, plan }) {
	for (const item of plan.statements) {
		await client.query(item.statement);
	}
	await ensureMigrationJournal(client);
	const existingJournalRows = await readDatabaseInventory(client);
	const existingHashes = new Set(existingJournalRows.journalRows.map((row) => row.hash));
	for (const migration of plan.journalRowsToInsert) {
		if (existingHashes.has(migration.hash)) {
			continue;
		}
		await client.query(
			`insert into ${quoteIdentifier(APP_API_MIGRATIONS_SCHEMA)}.${quoteIdentifier(APP_API_MIGRATIONS_TABLE)} ("hash", "created_at") values ($1, $2)`,
			[migration.hash, migration.folderMillis],
		);
		existingHashes.add(migration.hash);
	}
}

function normalizePostgresConnectionStringForExplicitSsl(connectionString) {
	const nextUrl = new URL(connectionString);
	nextUrl.searchParams.delete("sslmode");
	return nextUrl.toString();
}

function readRequiredOperatorDatabaseUrl(env = process.env) {
	const value =
		env.APP_API_OPERATOR_DATABASE_URL?.trim() || env.APP_API_MANAGEMENT_DATABASE_URL?.trim();
	if (!value) {
		throw new Error(
			"APP_API_OPERATOR_DATABASE_URL is required for shared-db adoption. Legacy APP_API_MANAGEMENT_DATABASE_URL is accepted as a compatibility alias.",
		);
	}
	return normalizePostgresConnectionStringForExplicitSsl(value);
}

function readSslMode(env = process.env) {
	return env.APP_API_DATABASE_SSLMODE?.trim() || "require";
}

export function formatPlan(plan) {
	return JSON.stringify(
		{
			journalRowsToInsert: plan.journalRowsToInsert.map((item) => ({
				createdAt: item.folderMillis,
				hash: item.hash,
				tag: item.tag,
			})),
			mismatches: plan.mismatches,
			state: plan.state,
			statements: plan.statements.map((item) => ({
				migrationTag: item.migrationTag,
				target: item.target.existsKey,
			})),
		},
		null,
		2,
	);
}

export async function runSharedDatabaseAdoption({ apply = false, env = process.env } = {}) {
	const migrationContext = loadMigrationContext();
	const connectionString = readRequiredOperatorDatabaseUrl(env);
	const sslMode = readSslMode(env);
	const inventory = await inspectSharedDatabase({ connectionString, sslMode });
	const plan = buildAdoptionPlan({
		inventory,
		migrationContext,
	});

	if (plan.mismatches.length > 0) {
		throw new Error(`Shared database adoption blocked:\n${plan.mismatches.join("\n")}`);
	}

	if (!apply) {
		return {
			applied: false,
			inventory,
			plan,
		};
	}

	const client = new pg.Client({
		connectionString,
		ssl: sslMode === "disable" ? false : { rejectUnauthorized: false },
	});
	await client.connect();
	try {
		await applyAdoptionPlan({ client, plan });
	} finally {
		await client.end();
	}

	const postApplyInventory = await inspectSharedDatabase({ connectionString, sslMode });
	const postApplyPlan = buildAdoptionPlan({
		inventory: postApplyInventory,
		migrationContext,
	});
	if (postApplyPlan.mismatches.length > 0 || postApplyPlan.statements.length > 0) {
		throw new Error(`Shared database adoption did not converge:\n${formatPlan(postApplyPlan)}`);
	}

	return {
		applied: true,
		inventory: postApplyInventory,
		plan: postApplyPlan,
	};
}

export function parseArgs(argv) {
	return {
		apply: argv.includes("--apply"),
		json: argv.includes("--json"),
	};
}
