import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	DrizzleSnapshot,
	NormalizedColumnSpec,
	TableSpec,
	TableSpecMap,
} from "./shared-db-script-types.ts";
import {
	buildExpectedTableSpecs,
	splitCurrentSchemaStatements,
} from "./shared-product-schema-context.ts";
import { APP_API_KNOWN_SCHEMAS } from "./shared-product-schema-shared.ts";

const sharedProductSchemaRoot = fileURLToPath(
	new URL("../../../db/shared-product-schema/", import.meta.url),
);

function cloneTableSpec(tableSpec: TableSpec): TableSpec {
	return {
		columns: new Map(
			[...tableSpec.columns.entries()].map(([columnName, column]) => [columnName, { ...column }]),
		),
		constraints: new Set(tableSpec.constraints),
		indexes: new Map(
			[...tableSpec.indexes.entries()].map(([indexName, index]) => [
				indexName,
				{
					...index,
					columns: [...index.columns],
				},
			]),
		),
		schema: tableSpec.schema,
		table: tableSpec.table,
	};
}

function normalizeColumnDefinitionType(definition: string): string {
	const withoutDefault = definition.split(/\s+DEFAULT\s+/i)[0] ?? definition;
	const type = withoutDefault
		.replace(/\s+PRIMARY\s+KEY\b/gi, "")
		.replace(/\s+NOT\s+NULL\b/gi, "")
		.replace(/\s+NULL\b/gi, "")
		.replace(/\s+REFERENCES\b[\s\S]+$/i, "")
		.trim()
		.toLowerCase();
	return type === "timestamptz" ? "timestamp with time zone" : type;
}

function parseSharedProductColumnDefinition(definition: string): NormalizedColumnSpec {
	const match = definition.trim().match(/^(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+([\s\S]+)$/iu);
	if (!match) {
		throw new Error(`Unsupported shared-product column definition: ${definition.trim()}`);
	}
	const rawDefinition = match[3].replace(/[,;]$/u, "").trim();
	return {
		defaultValue: null,
		name: match[1] ?? match[2],
		notNull: /\bNOT\s+NULL\b/i.test(rawDefinition),
		primaryKey: /\bPRIMARY\s+KEY\b/i.test(rawDefinition),
		type: normalizeColumnDefinitionType(rawDefinition),
	};
}

function listSharedProductSchemaFiles(): string[] {
	return readdirSync(sharedProductSchemaRoot, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
		.map((entry) => join(sharedProductSchemaRoot, entry.name))
		.sort();
}

function splitTopLevelSqlList(input: string): string[] {
	return input
		.split(/,\s*\n/u)
		.map((item) => item.trim())
		.filter(Boolean);
}

function ensureCurrentSharedProductTableSpec(
	specs: TableSpecMap,
	schema: string,
	table: string,
): TableSpec {
	const qualifiedName = `${schema}.${table}`;
	let tableSpec = specs.get(qualifiedName);
	if (!tableSpec) {
		tableSpec = {
			columns: new Map(),
			constraints: new Set(),
			indexes: new Map(),
			schema,
			table,
		};
		specs.set(qualifiedName, tableSpec);
	}
	return tableSpec;
}

function applySharedProductCreateTableStatement(specs: TableSpecMap, statement: string): boolean {
	const match = statement.match(
		/^CREATE TABLE IF NOT EXISTS "([^"]+)"\."([^"]+)"\s+\(([\s\S]+)\);?$/i,
	);
	if (!match) {
		return false;
	}

	const tableSpec = ensureCurrentSharedProductTableSpec(specs, match[1], match[2]);
	for (const definition of splitTopLevelSqlList(match[3])) {
		const primaryKeyMatch = definition.match(/^PRIMARY\s+KEY\s+\(([\s\S]+)\)$/i);
		if (primaryKeyMatch) {
			for (const columnName of primaryKeyMatch[1]
				.split(",")
				.map((column) => column.trim().replace(/^"|"$/gu, ""))) {
				const column = tableSpec.columns.get(columnName);
				if (!column) {
					throw new Error(
						`Shared-product primary key references unknown column ${match[1]}.${match[2]}.${columnName}`,
					);
				}
				column.primaryKey = true;
				column.notNull = true;
			}
			continue;
		}
		const column = parseSharedProductColumnDefinition(definition);
		tableSpec.columns.set(column.name, column);
	}
	return true;
}

function applySharedProductCreateIndexStatement(specs: TableSpecMap, statement: string): boolean {
	const match = statement.match(
		/^CREATE (UNIQUE )?INDEX(?: IF NOT EXISTS)? (?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+ON\s+"([^"]+)"\."([^"]+)"(?:\s+USING\s+(\w+))?\s+\(([\s\S]+?)\)(?:\s+WHERE\s+[\s\S]+)?;?$/i,
	);
	if (!match) {
		return false;
	}

	const indexName = match[2] ?? match[3];
	const tableSpec = ensureCurrentSharedProductTableSpec(specs, match[4], match[5]);
	tableSpec.indexes.set(indexName, {
		columns: match[7].split(",").map((column: string) =>
			column
				.trim()
				.replace(/\s+(ASC|DESC)\b/iu, "")
				.replace(/^"|"$/gu, ""),
		),
		method: (match[6] ?? "btree").toLowerCase(),
		name: indexName,
		unique: Boolean(match[1]),
	});
	return true;
}

interface SharedProductSqlToken {
	kind: "number" | "quoted_identifier" | "string" | "symbol" | "word";
	value: string;
}

interface SharedProductDoSegment {
	kind: "if" | "statement";
	tokens: SharedProductSqlToken[];
}

function tokenizeSharedProductSql(input: string): SharedProductSqlToken[] | null {
	const tokens: SharedProductSqlToken[] = [];
	let index = 0;
	while (index < input.length) {
		const character = input[index];
		if (/\s/u.test(character)) {
			index += 1;
			continue;
		}
		if (character === "'") {
			let value = "";
			let closed = false;
			index += 1;
			while (index < input.length) {
				if (input[index] === "'" && input[index + 1] === "'") {
					value += "'";
					index += 2;
					continue;
				}
				if (input[index] === "'") {
					index += 1;
					closed = true;
					break;
				}
				value += input[index];
				index += 1;
			}
			if (!closed) {
				return null;
			}
			tokens.push({
				kind: "string",
				value: value.replace(/\s+/gu, " ").trim(),
			});
			continue;
		}
		if (character === '"') {
			let value = "";
			let closed = false;
			index += 1;
			while (index < input.length) {
				if (input[index] === '"' && input[index + 1] === '"') {
					value += '"';
					index += 2;
					continue;
				}
				if (input[index] === '"') {
					index += 1;
					closed = true;
					break;
				}
				value += input[index];
				index += 1;
			}
			if (!closed) {
				return null;
			}
			tokens.push({ kind: "quoted_identifier", value });
			continue;
		}
		const twoCharacterSymbol = input.slice(index, index + 2);
		if (["::", "<>", "<=", ">=", "!=", "||"].includes(twoCharacterSymbol)) {
			tokens.push({ kind: "symbol", value: twoCharacterSymbol });
			index += 2;
			continue;
		}
		if (/[A-Za-z_]/u.test(character)) {
			const word = input.slice(index).match(/^[A-Za-z_][A-Za-z_0-9]*/u)?.[0];
			if (!word) {
				return null;
			}
			tokens.push({ kind: "word", value: word.toLowerCase() });
			index += word.length;
			continue;
		}
		if (/[0-9]/u.test(character)) {
			const number = input.slice(index).match(/^[0-9]+/u)?.[0];
			if (!number) {
				return null;
			}
			tokens.push({ kind: "number", value: number });
			index += number.length;
			continue;
		}
		if (["(", ")", ",", ";", ".", "="].includes(character)) {
			tokens.push({ kind: "symbol", value: character });
			index += 1;
			continue;
		}
		return null;
	}
	return tokens;
}

function sharedProductSqlTokenIs(
	token: SharedProductSqlToken | undefined,
	kind: SharedProductSqlToken["kind"],
	value: string,
): boolean {
	return token?.kind === kind && token.value === value;
}

function parseSharedProductDoBody(statement: string): string | null {
	const doPrefix = statement.match(/^DO\b/iu)?.[0];
	if (!doPrefix) {
		return null;
	}
	const afterDo = statement.slice(doPrefix.length).trimStart();
	const openingTag = afterDo.match(/^\$[A-Za-z_0-9]*\$/u)?.[0];
	if (!openingTag) {
		return null;
	}
	let afterOpeningTag = afterDo.slice(openingTag.length).trimEnd();
	if (afterOpeningTag.endsWith(";")) {
		afterOpeningTag = afterOpeningTag.slice(0, -1).trimEnd();
	}
	if (!afterOpeningTag.endsWith(openingTag)) {
		return null;
	}
	return afterOpeningTag.slice(0, -openingTag.length);
}

function parseSharedProductDoSegments(
	tokens: SharedProductSqlToken[],
): SharedProductDoSegment[] | null {
	if (!sharedProductSqlTokenIs(tokens[0], "word", "begin")) {
		return null;
	}
	const segments: SharedProductDoSegment[] = [];
	let index = 1;
	while (index < tokens.length) {
		if (sharedProductSqlTokenIs(tokens[index], "word", "end")) {
			index += 1;
			if (sharedProductSqlTokenIs(tokens[index], "symbol", ";")) {
				index += 1;
			}
			return index === tokens.length ? segments : null;
		}
		const segmentStart = index;
		if (sharedProductSqlTokenIs(tokens[index], "word", "if")) {
			let depth = 0;
			let segmentEnd = -1;
			while (index < tokens.length) {
				if (
					sharedProductSqlTokenIs(tokens[index], "word", "end") &&
					sharedProductSqlTokenIs(tokens[index + 1], "word", "if")
				) {
					depth -= 1;
					index += 2;
					if (depth === 0 && sharedProductSqlTokenIs(tokens[index], "symbol", ";")) {
						segmentEnd = index + 1;
						break;
					}
					continue;
				}
				if (sharedProductSqlTokenIs(tokens[index], "word", "if")) {
					depth += 1;
				}
				index += 1;
			}
			if (segmentEnd < 0) {
				return null;
			}
			segments.push({ kind: "if", tokens: tokens.slice(segmentStart, segmentEnd) });
			index = segmentEnd;
			continue;
		}
		while (index < tokens.length && !sharedProductSqlTokenIs(tokens[index], "symbol", ";")) {
			index += 1;
		}
		if (index >= tokens.length) {
			return null;
		}
		index += 1;
		segments.push({ kind: "statement", tokens: tokens.slice(segmentStart, index) });
	}
	return null;
}

function sharedProductSqlFingerprint(tokens: SharedProductSqlToken[]): string {
	return tokens.map((token) => `${token.kind}:${token.value.length}:${token.value}`).join("|");
}

function sharedProductSqlSourceFingerprint(source: string): string {
	const tokens = tokenizeSharedProductSql(source);
	if (!tokens) {
		throw new Error("Invalid internal shared-product SQL allowlist entry");
	}
	return sharedProductSqlFingerprint(tokens);
}

const turnDispatchLockStatement = 'LOCK TABLE "chat"."turn_dispatches" IN ACCESS EXCLUSIVE MODE;';
const turnDispatchLockFingerprint = sharedProductSqlSourceFingerprint(turnDispatchLockStatement);

function turnDispatchAddColumnStatement(columnName: string, definition: string): string {
	return `ALTER TABLE "chat"."turn_dispatches"
		ADD COLUMN IF NOT EXISTS "${columnName}" ${definition};`;
}

const turnDispatchCompatibilityStatementFingerprints = new Set(
	[
		...[
			["memory_recall_enabled", "boolean"],
			["memory_append_enabled", "boolean"],
			["memory_owner_generation", "bigint"],
			["memory_owner_sequence", "bigint"],
			["assistant_message_id", "text"],
			["admission_status", "text DEFAULT 'pending_admission' NOT NULL"],
			["workflow_id", "text"],
			["admission_input_json", "text"],
			["admission_input_sha256", "text"],
			["execution_input_json", "text"],
			["execution_input_sha256", "text"],
			["execution_input_released_at", "timestamp with time zone"],
			["admitted_at", "timestamp with time zone"],
			["cancel_outbox_status", "text DEFAULT 'not_requested' NOT NULL"],
			["cancel_reason", "text"],
			["cancel_requested_at", "timestamp with time zone"],
			["cancel_attempt_count", "integer DEFAULT 0 NOT NULL"],
			["cancel_last_attempt_at", "timestamp with time zone"],
			["cancel_last_error_code", "text"],
			["cancel_delivered_at", "timestamp with time zone"],
			["finalization_fingerprint", "text"],
		].map(([columnName, definition]) => turnDispatchAddColumnStatement(columnName, definition)),
		`UPDATE "chat"."turn_dispatches"
			SET "assistant_message_id" = "request_id" || ':assistant'
			WHERE "assistant_message_id" IS NULL;`,
		`ALTER TABLE "chat"."turn_dispatches"
			ALTER COLUMN "assistant_message_id" SET NOT NULL;`,
		`ALTER TABLE "chat"."turn_dispatches"
			ALTER COLUMN "admission_status" SET DEFAULT 'pending_admission';`,
	].map(sharedProductSqlSourceFingerprint),
);

const turnDispatchV2DrainGuardDoSegmentFingerprints = [
	sharedProductSqlSourceFingerprint(`
		IF EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'chat' AND table_name = 'turn_dispatches'
				AND column_name = 'workflow_input_json'
		) AND EXISTS (
			SELECT 1 FROM "chat"."turn_dispatches"
			WHERE "status" NOT IN (
				'completed', 'needs_clarification', 'no_answer', 'error',
				'approval_required', 'rejected', 'cancelled'
			)
		) THEN
			RAISE EXCEPTION
				'agent runtime schema migration requires all legacy chat runs to be in a contract terminal status';
		END IF;
	`),
];

const legacyTurnDispatchPayloadCleanupDoSegmentFingerprints = [
	sharedProductSqlSourceFingerprint(`
		IF EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'chat' AND table_name = 'turn_dispatches'
				AND column_name = 'workflow_input_json'
		) THEN
			UPDATE "chat"."turn_dispatches"
			SET "admission_status" = CASE
					WHEN "admission_status" IN ('admitted', 'admission_failed', 'cancelled')
						THEN "admission_status"
					WHEN "status" = 'cancelled' THEN 'cancelled'
					ELSE 'admitted'
				END,
				"admission_input_json" = NULL,
				"admission_input_sha256" = NULL,
				"execution_input_json" = NULL,
				"execution_input_sha256" = NULL,
				"execution_input_released_at" = COALESCE("completed_at", "updated_at");
			ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "workflow_input_json";
		END IF;
	`),
	sharedProductSqlSourceFingerprint(`
		IF EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'chat' AND table_name = 'turn_dispatches'
				AND column_name = 'workflow_input_sha256'
		) THEN
			ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "workflow_input_sha256";
		END IF;
	`),
];

function turnDispatchConstraintDoSegment(constraintName: string, checkExpression: string): string {
	return `
		IF NOT EXISTS (
			SELECT 1 FROM pg_constraint
			WHERE conname = '${constraintName}'
				AND conrelid = '"chat"."turn_dispatches"'::regclass
		) THEN
			ALTER TABLE "chat"."turn_dispatches"
			ADD CONSTRAINT "${constraintName}" CHECK (${checkExpression});
		END IF;
	`;
}

const turnDispatchConstraintDoSegmentFingerprints = [
	turnDispatchConstraintDoSegment(
		"chat_turn_dispatches_cancel_outbox_status_check",
		`"cancel_outbox_status" IN (
			'not_requested', 'local_finalization_pending', 'pending_delivery', 'delivered', 'closed'
		)`,
	),
	turnDispatchConstraintDoSegment(
		"chat_turn_dispatches_admission_status_check",
		`"admission_status" IN (
			'pending_admission', 'dispatching', 'admitted', 'admission_failed', 'cancelled'
		)`,
	),
	turnDispatchConstraintDoSegment(
		"chat_turn_dispatches_admission_input_pair_check",
		'("admission_input_json" IS NULL) = ("admission_input_sha256" IS NULL)',
	),
	turnDispatchConstraintDoSegment(
		"chat_turn_dispatches_execution_input_pair_check",
		'("execution_input_json" IS NULL) = ("execution_input_sha256" IS NULL)',
	),
	turnDispatchConstraintDoSegment(
		"chat_turn_dispatches_execution_input_release_check",
		`"execution_input_released_at" IS NULL
			OR (
				"execution_input_json" IS NULL
				AND "execution_input_sha256" IS NULL
			)`,
	),
	turnDispatchConstraintDoSegment(
		"chat_turn_dispatches_input_lifecycle_check",
		`(
				"status" = 'accepted'
				AND "run_id" IS NOT NULL
				AND "workflow_id" IS NOT NULL
				AND (
					(
						"admission_status" IN ('pending_admission', 'dispatching')
						AND "admission_input_json" IS NOT NULL
						AND "admission_input_sha256" IS NOT NULL
						AND "execution_input_json" IS NOT NULL
						AND "execution_input_sha256" IS NOT NULL
						AND "execution_input_released_at" IS NULL
					)
					OR (
						"admission_status" = 'admitted'
						AND "admission_input_json" IS NULL
						AND "admission_input_sha256" IS NULL
						AND "execution_input_json" IS NOT NULL
						AND "execution_input_sha256" IS NOT NULL
						AND "execution_input_released_at" IS NULL
					)
					OR (
						"admission_status" = 'cancelled'
						AND "cancel_outbox_status" = 'local_finalization_pending'
						AND "admission_input_json" IS NULL
						AND "admission_input_sha256" IS NULL
						AND "execution_input_json" IS NULL
						AND "execution_input_sha256" IS NULL
						AND "execution_input_released_at" IS NOT NULL
					)
				)
			)
			OR (
				"status" IN (
					'completed', 'needs_clarification', 'no_answer', 'error',
					'approval_required', 'rejected', 'cancelled'
				)
				AND "admission_input_json" IS NULL
				AND "admission_input_sha256" IS NULL
				AND (
					(
						"admission_status" = 'admitted'
						AND "execution_input_json" IS NOT NULL
						AND "execution_input_sha256" IS NOT NULL
						AND "execution_input_released_at" IS NULL
					)
					OR (
						"admission_status" IN ('admitted', 'admission_failed', 'cancelled')
						AND "execution_input_json" IS NULL
						AND "execution_input_sha256" IS NULL
						AND "execution_input_released_at" IS NOT NULL
					)
				)
			)`,
	),
].map(sharedProductSqlSourceFingerprint);

function sharedProductFingerprintListsEqual(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isKnownTurnDispatchDoBlock(statement: string): boolean {
	const body = parseSharedProductDoBody(statement);
	if (body === null) {
		return false;
	}
	const tokens = tokenizeSharedProductSql(body);
	if (!tokens) {
		return false;
	}
	const segments = parseSharedProductDoSegments(tokens);
	if (!segments) {
		return false;
	}
	const segmentFingerprints = segments.map((segment) =>
		sharedProductSqlFingerprint(segment.tokens),
	);
	return (
		sharedProductFingerprintListsEqual(
			segmentFingerprints,
			turnDispatchV2DrainGuardDoSegmentFingerprints,
		) ||
		sharedProductFingerprintListsEqual(
			segmentFingerprints,
			legacyTurnDispatchPayloadCleanupDoSegmentFingerprints,
		) ||
		sharedProductFingerprintListsEqual(
			segmentFingerprints,
			turnDispatchConstraintDoSegmentFingerprints,
		)
	);
}

function isTurnDispatchAccessExclusiveLock(statement: string): boolean {
	const tokens = tokenizeSharedProductSql(statement);
	return tokens !== null && sharedProductSqlFingerprint(tokens) === turnDispatchLockFingerprint;
}

function isKnownTurnDispatchCompatibilityStatement(statement: string): boolean {
	const tokens = tokenizeSharedProductSql(statement);
	return (
		tokens !== null &&
		turnDispatchCompatibilityStatementFingerprints.has(sharedProductSqlFingerprint(tokens))
	);
}

function applySharedProductSchemaStatement(specs: TableSpecMap, statement: string): void {
	const trimmed = statement.trim();
	if (
		applySharedProductCreateTableStatement(specs, trimmed) ||
		applySharedProductCreateIndexStatement(specs, trimmed)
	) {
		return;
	}
	if (/^CREATE SCHEMA(?: IF NOT EXISTS)? "[a-z_][a-z0-9_]*";?$/i.test(trimmed)) {
		return;
	}
	if (isKnownTurnDispatchDoBlock(trimmed) || isTurnDispatchAccessExclusiveLock(trimmed)) {
		return;
	}
	if (/^DROP INDEX IF EXISTS "chat"\."chat_turn_dispatches_run_id_idx";?$/iu.test(trimmed)) {
		return;
	}
	if (isKnownTurnDispatchCompatibilityStatement(trimmed)) {
		return;
	}
	throw new Error(`Unsupported shared-product schema baseline statement shape: ${trimmed}`);
}

export function validateSharedProductCurrentSchemaSql(source: string): void {
	const specs: TableSpecMap = new Map();
	for (const statement of splitCurrentSchemaStatements(source)) {
		applySharedProductSchemaStatement(specs, statement);
	}
}

function buildSharedProductSchemaTableSpecs(): TableSpecMap {
	const specs: TableSpecMap = new Map();
	for (const schemaFile of listSharedProductSchemaFiles()) {
		const source = readFileSync(schemaFile, "utf8");
		for (const statement of splitCurrentSchemaStatements(source)) {
			applySharedProductSchemaStatement(specs, statement);
		}
	}
	return specs;
}

export function buildCurrentSharedDatabaseExpectedTableSpecs(
	snapshot: DrizzleSnapshot,
): TableSpecMap {
	const specs = buildExpectedTableSpecs(snapshot);
	for (const [qualifiedName, tableSpec] of buildSharedProductSchemaTableSpecs()) {
		if (specs.has(qualifiedName) || !APP_API_KNOWN_SCHEMAS.includes(tableSpec.schema)) {
			continue;
		}
		specs.set(qualifiedName, cloneTableSpec(tableSpec));
	}
	return new Map(
		[...specs.entries()].map(([qualifiedName, tableSpec]) => [
			qualifiedName,
			cloneTableSpec(tableSpec),
		]),
	);
}
