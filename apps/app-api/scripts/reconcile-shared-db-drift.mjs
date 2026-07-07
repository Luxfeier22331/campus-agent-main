import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
	inspectSharedDatabase,
	loadMigrationContext,
	runSharedDatabaseAdoption,
} from "./adopt-shared-database.mjs";
import {
	buildCurrentSharedDatabaseExpectedTableSpecs,
	buildSharedDatabaseDriftReconcilePlan,
	collectExtraTables,
	formatSharedDatabaseDriftReconcilePlan,
	quoteIdentifier,
} from "./reconcile-shared-db-drift-plan.mjs";

export {
	buildCurrentSharedDatabaseExpectedTableSpecs,
	buildSharedDatabaseDriftReconcilePlan,
} from "./reconcile-shared-db-drift-plan.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const appRoot = dirname(scriptsDir);

function normalizePostgresConnectionStringForExplicitSsl(connectionString) {
	const nextUrl = new URL(connectionString);
	nextUrl.searchParams.delete("sslmode");
	return nextUrl.toString();
}

function readRequiredOperatorDatabaseUrl(env = process.env) {
	const value = env.APP_API_OPERATOR_DATABASE_URL?.trim();
	if (!value) {
		throw new Error(
			"APP_API_OPERATOR_DATABASE_URL is required for shared-db drift reconciliation.",
		);
	}
	return normalizePostgresConnectionStringForExplicitSsl(value);
}

function readSslMode(env = process.env) {
	return env.APP_API_DATABASE_SSLMODE?.trim() || "require";
}

function openClient({ connectionString, sslMode }) {
	return new pg.Client({
		connectionString,
		ssl: sslMode === "disable" ? false : { rejectUnauthorized: false },
	});
}

async function readExtraTableRowCounts(client, extraTables) {
	const rowCounts = new Map();

	for (const qualifiedName of extraTables) {
		const [schema, table] = qualifiedName.split(".", 2);
		const result = await client.query(
			`select count(*)::int as count from ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
		);
		rowCounts.set(qualifiedName, result.rows[0]?.count ?? 0);
	}

	return rowCounts;
}

async function readColumnBackupRows(client, qualifiedName, columns) {
	const [schema, table] = qualifiedName.split(".", 2);
	const selectList = columns.map((column) => quoteIdentifier(column)).join(", ");
	const result = await client.query(
		`select ${selectList} from ${quoteIdentifier(schema)}.${quoteIdentifier(table)} order by 1`,
	);
	return result.rows;
}

async function writeBackupArtifacts({ backupDir, client, inventory, plan }) {
	const resolvedBackupDir = resolve(appRoot, backupDir);
	await mkdir(resolvedBackupDir, { recursive: true });

	const backups = {
		generatedAt: new Date().toISOString(),
		inventory: {
			journalRows: inventory.journalRows,
			tables: [...inventory.tables.keys()].sort(),
		},
		plan,
	};
	await writeFile(
		join(resolvedBackupDir, "manifest.json"),
		`${JSON.stringify(backups, null, 2)}\n`,
	);

	for (const extraTable of plan.extraTables) {
		const [schema, table] = extraTable.qualifiedName.split(".", 2);
		const rows = await client.query(
			`select * from ${quoteIdentifier(schema)}.${quoteIdentifier(table)} order by 1`,
		);
		await writeFile(
			join(resolvedBackupDir, `${schema}__${table}.rows.json`),
			`${JSON.stringify(rows.rows, null, 2)}\n`,
		);
	}

	for (const extraColumn of plan.extraColumns) {
		const rows = await readColumnBackupRows(client, extraColumn.qualifiedName, [
			extraColumn.columnName,
		]);
		await writeFile(
			join(
				resolvedBackupDir,
				`${extraColumn.qualifiedName.replace(".", "__")}__${extraColumn.columnName}.column.json`,
			),
			`${JSON.stringify(rows, null, 2)}\n`,
		);
	}

	for (const legacyColumn of plan.legacyColumnResolutions ?? []) {
		const backupColumns =
			legacyColumn.kind === "merge_drop_legacy_column"
				? [legacyColumn.fromColumn, legacyColumn.toColumn]
				: [legacyColumn.fromColumn];
		const rows = await readColumnBackupRows(client, legacyColumn.qualifiedName, backupColumns);
		await writeFile(
			join(
				resolvedBackupDir,
				`${legacyColumn.qualifiedName.replace(".", "__")}__${legacyColumn.fromColumn}.legacy-column.json`,
			),
			`${JSON.stringify(rows, null, 2)}\n`,
		);
	}

	if (plan.orphanedJournalRows.length > 0) {
		await writeFile(
			join(resolvedBackupDir, "drizzle__app_api_migrations.orphaned.json"),
			`${JSON.stringify(plan.orphanedJournalRows, null, 2)}\n`,
		);
	}

	return resolvedBackupDir;
}

async function applySharedDatabaseDriftReconcilePlan(client, plan) {
	await client.query("begin");
	try {
		for (const operation of plan.operations) {
			if (operation.kind === "delete_journal_row") {
				await client.query(operation.statement, [operation.hash]);
				continue;
			}
			if (operation.kind === "insert_journal_row") {
				await client.query(operation.statement, [operation.hash, operation.createdAt]);
				continue;
			}

			await client.query(operation.statement);
		}
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
}

export async function runSharedDatabaseDriftReconcile({
	allowNonEmptyDriftTables = false,
	apply = false,
	backupDir = null,
	env = process.env,
} = {}) {
	const migrationContext = loadMigrationContext();
	const connectionString = readRequiredOperatorDatabaseUrl(env);
	const sslMode = readSslMode(env);
	const inventory = await inspectSharedDatabase({ connectionString, sslMode });
	const client = openClient({ connectionString, sslMode });
	await client.connect();

	try {
		const rowCounts = await readExtraTableRowCounts(
			client,
			collectExtraTables(
				inventory,
				buildCurrentSharedDatabaseExpectedTableSpecs(migrationContext.latestSnapshot),
			),
		);
		const plan = buildSharedDatabaseDriftReconcilePlan({
			extraTableRowCounts: rowCounts,
			inventory,
			migrationContext,
		});

		if (plan.blockedReasons.length > 0) {
			throw new Error(
				`Shared database drift reconciliation blocked:\n${plan.blockedReasons.join("\n")}`,
			);
		}

		if (!allowNonEmptyDriftTables && plan.nonEmptyDriftTables.length > 0) {
			throw new Error(
				`Shared database drift reconciliation requires explicit non-empty approval:\n${plan.nonEmptyDriftTables
					.map((item) => `${item.qualifiedName} has ${item.rowCount} rows`)
					.join("\n")}`,
			);
		}

		let backupPath = null;
		if (backupDir) {
			backupPath = await writeBackupArtifacts({
				backupDir,
				client,
				inventory,
				plan,
			});
		}

		if (!apply) {
			return {
				applied: false,
				backupPath,
				plan,
			};
		}

		await applySharedDatabaseDriftReconcilePlan(client, plan);

		const reconciledInventory = await inspectSharedDatabase({ connectionString, sslMode });
		const reconciledRowCounts = await readExtraTableRowCounts(
			client,
			collectExtraTables(
				reconciledInventory,
				buildCurrentSharedDatabaseExpectedTableSpecs(migrationContext.latestSnapshot),
			),
		);
		const reconciledPlan = buildSharedDatabaseDriftReconcilePlan({
			extraTableRowCounts: reconciledRowCounts,
			inventory: reconciledInventory,
			migrationContext,
		});
		if (reconciledPlan.driftDetected || reconciledPlan.blockedReasons.length > 0) {
			throw new Error(
				`Shared database drift reconciliation did not remove all retired drift:\n${formatSharedDatabaseDriftReconcilePlan(reconciledPlan)}`,
			);
		}

		let adoptionResult = await runSharedDatabaseAdoption({ apply: false, env });
		if (adoptionResult.plan.mismatches.length > 0) {
			throw new Error(
				`Shared database drift reconciliation did not converge to repo truth:\n${JSON.stringify(
					{
						mismatches: adoptionResult.plan.mismatches,
						statements: adoptionResult.plan.statements.map((item) => item.target.existsKey),
					},
					null,
					2,
				)}`,
			);
		}
		if (
			adoptionResult.plan.statements.length > 0 ||
			adoptionResult.plan.journalRowsToInsert.length > 0
		) {
			await runSharedDatabaseAdoption({ apply: true, env });
			adoptionResult = await runSharedDatabaseAdoption({ apply: false, env });
			if (adoptionResult.plan.mismatches.length > 0 || adoptionResult.plan.statements.length > 0) {
				throw new Error(
					`Shared database drift reconciliation did not converge to repo truth:\n${JSON.stringify(
						{
							mismatches: adoptionResult.plan.mismatches,
							statements: adoptionResult.plan.statements.map((item) => item.target.existsKey),
						},
						null,
						2,
					)}`,
				);
			}
		}

		return {
			applied: true,
			backupPath,
			plan,
		};
	} finally {
		await client.end();
	}
}

function parseArgs(argv) {
	let backupDir = null;

	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--backup-dir") {
			backupDir = argv[index + 1] ?? null;
		}
	}

	return {
		allowNonEmptyDriftTables: argv.includes("--allow-non-empty-drift-tables"),
		apply: argv.includes("--apply"),
		backupDir,
		json: argv.includes("--json"),
	};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = parseArgs(process.argv.slice(2));
	runSharedDatabaseDriftReconcile({
		allowNonEmptyDriftTables: args.allowNonEmptyDriftTables,
		apply: args.apply,
		backupDir: args.backupDir,
	})
		.then((result) => {
			const payload = {
				applied: result.applied,
				backupPath: result.backupPath,
				plan: result.plan,
			};
			if (args.json) {
				console.log(`${JSON.stringify(payload, null, 2)}\n`);
				return;
			}

			console.log(formatSharedDatabaseDriftReconcilePlan(result.plan));
			if (result.backupPath) {
				console.log(`backup_path: ${result.backupPath}`);
			}
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
