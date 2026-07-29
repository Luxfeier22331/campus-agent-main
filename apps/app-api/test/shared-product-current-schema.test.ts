// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	buildCurrentSharedDatabaseExpectedTableSpecs,
	validateSharedProductCurrentSchemaSql,
} from "../src/script-support/shared-db/shared-product-current-schema.ts";
import {
	buildExpectedTableSpecs,
	loadCurrentDrizzleSnapshot,
	splitCurrentSchemaStatements,
} from "../src/script-support/shared-db/shared-product-schema-context.ts";

const currentSnapshot = loadCurrentDrizzleSnapshot();
const currentChatSchemaSql = readFileSync(
	new URL("../db/shared-product-schema/chat_current.sql", import.meta.url),
	"utf8",
);
const currentTurnDispatchDoBlocks = splitCurrentSchemaStatements(currentChatSchemaSql).filter(
	(statement) => /^DO\b/iu.test(statement),
);

describe("app-api shared product current schema", () => {
	it("supplements drizzle snapshots with shared-product tables that are current repo truth", () => {
		const drizzleSpecs = buildExpectedTableSpecs(currentSnapshot);
		const currentSpecs = buildCurrentSharedDatabaseExpectedTableSpecs(currentSnapshot);

		expect(drizzleSpecs.has("chat.conversations")).toBe(false);
		expect(
			[...currentSpecs.keys()].filter((qualifiedName) => !drizzleSpecs.has(qualifiedName)),
		).toEqual(
			expect.arrayContaining([
				"campus_services.transport_current",
				"campus_services.transport_departures",
				"campus_services.transport_releases",
				"campus_services.transport_routes",
				"chat.conversations",
				"chat.message_feedback",
				"chat.messages",
				"chat.session_slots",
			]),
		);
		expect(currentSpecs.get("chat.conversations")).toMatchObject({
			schema: "chat",
			table: "conversations",
		});
		expect(currentSpecs.get("chat.conversations")?.columns.get("owner_user_id")).toMatchObject({
			name: "owner_user_id",
			notNull: true,
			type: "text",
		});
		expect(currentSpecs.get("chat.messages")?.columns.get("structured_parts_json")).toMatchObject({
			name: "structured_parts_json",
			notNull: false,
			type: "jsonb",
		});
		expect(currentSpecs.get("chat.message_feedback")?.columns.get("vote")).toMatchObject({
			name: "vote",
			notNull: true,
			type: "text",
		});
		expect([...(currentSpecs.get("chat.conversations")?.indexes.keys() ?? [])]).toEqual(
			expect.arrayContaining([
				"chat_conversations_owner_archived_updated_at_idx",
				"chat_conversations_owner_deleted_updated_at_idx",
				"chat_conversations_owner_pinned_updated_at_idx",
				"chat_conversations_owner_updated_at_idx",
			]),
		);
		expect(currentSpecs.has("dining.menu_offerings")).toBe(false);
	});

	it.each([
		"ALTER TABLE",
		"DROP TABLE",
		"INSERT INTO",
		"UPDATE",
		"DELETE FROM",
	])("rejects %s statements from the current schema baseline", (statement) => {
		expect(() => validateSharedProductCurrentSchemaSql(`${statement} chat.messages;`)).toThrow(
			"Unsupported shared-product schema baseline statement shape",
		);
	});

	it("accepts allowlisted turn-dispatch column changes across lines", () => {
		expect(() =>
			validateSharedProductCurrentSchemaSql(`
				ALTER TABLE "chat"."turn_dispatches"
				ADD COLUMN IF NOT EXISTS "admission_status" text DEFAULT 'pending_admission' NOT NULL;
			`),
		).not.toThrow();
	});

	it.each([
		[
			"an unknown added column",
			'ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "unsafe" text;',
		],
		[
			"a retired default",
			`ALTER TABLE "chat"."turn_dispatches"
			 ADD COLUMN IF NOT EXISTS "admission_status" text DEFAULT 'pending_input' NOT NULL;`,
		],
		[
			"an arbitrary column mutation",
			'ALTER TABLE "chat"."turn_dispatches" ALTER COLUMN "owner_user_id" DROP NOT NULL;',
		],
		[
			"an arbitrary data rewrite",
			`UPDATE "chat"."turn_dispatches"
			 SET "owner_user_id" = 'other-owner';`,
		],
		[
			"a broadened assistant-message backfill",
			`UPDATE "chat"."turn_dispatches"
			 SET "assistant_message_id" = "request_id" || ':assistant';`,
		],
	])("rejects %s in turn-dispatch compatibility SQL", (_name, statement) => {
		expect(() => validateSharedProductCurrentSchemaSql(statement)).toThrow(
			"Unsupported shared-product schema baseline statement shape",
		);
	});

	it("accepts the current structured turn-dispatch compatibility blocks", () => {
		expect(currentTurnDispatchDoBlocks.length).toBeGreaterThan(0);
		for (const statement of currentTurnDispatchDoBlocks) {
			expect(() => validateSharedProductCurrentSchemaSql(statement)).not.toThrow();
		}
	});

	it("accepts an equivalent dollar tag for a known compatibility block", () => {
		const statement = currentTurnDispatchDoBlocks[0];
		expect(statement).toBeDefined();
		const tagged = statement
			?.replace(/^DO\s+\$\$/iu, "DO $compat$")
			.replace(/\$\$;$/u, "$compat$;");
		expect(() => validateSharedProductCurrentSchemaSql(tagged ?? "")).not.toThrow();
	});

	it("accepts only the exact turn-dispatch access-exclusive lock", () => {
		expect(() =>
			validateSharedProductCurrentSchemaSql(
				'LOCK TABLE "chat"."turn_dispatches" IN ACCESS EXCLUSIVE MODE;',
			),
		).not.toThrow();
		for (const statement of [
			'LOCK TABLE "chat"."turn_dispatches" IN SHARE MODE;',
			'LOCK TABLE "chat"."messages" IN ACCESS EXCLUSIVE MODE;',
		]) {
			expect(() => validateSharedProductCurrentSchemaSql(statement)).toThrow(
				"Unsupported shared-product schema baseline statement shape",
			);
		}
	});

	it.each([
		["DROP SCHEMA", 'DROP SCHEMA "chat" CASCADE;'],
		["cross-table ALTER", 'ALTER TABLE "chat"."messages" ADD COLUMN "unsafe" text;'],
		["GRANT", 'GRANT SELECT ON "chat"."turn_dispatches" TO PUBLIC;'],
		["REVOKE", 'REVOKE SELECT ON "chat"."turn_dispatches" FROM PUBLIC;'],
		["TRUNCATE", 'TRUNCATE TABLE "chat"."turn_dispatches";'],
		["DELETE", 'DELETE\nFROM "chat"."turn_dispatches";'],
	])("rejects %s inside an otherwise turn-dispatch-referencing DO block", (_name, action) => {
		expect(() =>
			validateSharedProductCurrentSchemaSql(`
				DO $unsafe$
				BEGIN
					PERFORM 1 FROM "chat"."turn_dispatches";
					${action}
				END
				$unsafe$;
			`),
		).toThrow("Unsupported shared-product schema baseline statement shape");
	});

	it("rejects an extra statement appended to a known compatibility block", () => {
		const statement = currentTurnDispatchDoBlocks[0];
		expect(statement).toBeDefined();
		const mutated = statement?.replace(
			/\bEND(\s+\$[A-Za-z_0-9]*\$;)$/u,
			'GRANT SELECT ON "chat"."turn_dispatches" TO PUBLIC;\nEND$1',
		);
		expect(mutated).not.toBe(statement);
		expect(() => validateSharedProductCurrentSchemaSql(mutated ?? "")).toThrow(
			"Unsupported shared-product schema baseline statement shape",
		);
	});

	it("rejects the retired accepted-only v2 guard", () => {
		expect(() =>
			validateSharedProductCurrentSchemaSql(`
				DO $$
				BEGIN
					IF EXISTS (
						SELECT 1 FROM information_schema.columns
						WHERE table_schema = 'chat'
							AND table_name = 'turn_dispatches'
							AND column_name = 'workflow_input_json'
					) AND EXISTS (
						SELECT 1 FROM "chat"."turn_dispatches" WHERE "status" = 'accepted'
					) THEN
						RAISE EXCEPTION
							'USING tool_execution_v4 requires draining all accepted v2 chat runs before migration';
					END IF;
				END
				$$;
			`),
		).toThrow("Unsupported shared-product schema baseline statement shape");
	});

	it("rejects the retired workflow-payload copy block", () => {
		expect(() =>
			validateSharedProductCurrentSchemaSql(`
				DO $$
				BEGIN
					IF EXISTS (
						SELECT 1 FROM information_schema.columns
						WHERE table_schema = 'chat'
							AND table_name = 'turn_dispatches'
							AND column_name = 'workflow_input_json'
					) THEN
						EXECUTE '
							UPDATE "chat"."turn_dispatches"
							SET "admission_input_json" = "workflow_input_json"::text
							WHERE "admission_input_json" IS NULL
								AND "workflow_input_json" IS NOT NULL
						';
						EXECUTE 'ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "workflow_input_json"';
					END IF;
					IF EXISTS (
						SELECT 1 FROM information_schema.columns
						WHERE table_schema = 'chat'
							AND table_name = 'turn_dispatches'
							AND column_name = 'workflow_input_sha256'
					) THEN
						EXECUTE 'ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "workflow_input_sha256"';
					END IF;
				END
				$$;
			`),
		).toThrow("Unsupported shared-product schema baseline statement shape");
	});
});
