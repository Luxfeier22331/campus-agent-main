// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
	buildCurrentSharedDatabaseExpectedTableSpecs,
	validateSharedProductCurrentSchemaSql,
} from "../src/script-support/shared-db/shared-product-current-schema.ts";
import {
	buildExpectedTableSpecs,
	loadCurrentDrizzleSnapshot,
} from "../src/script-support/shared-db/shared-product-schema-context.ts";

const currentSnapshot = loadCurrentDrizzleSnapshot();

describe("app-api shared product current schema", () => {
	it("supplements drizzle snapshots with shared-product tables that are current repo truth", () => {
		const drizzleSpecs = buildExpectedTableSpecs(currentSnapshot);
		const currentSpecs = buildCurrentSharedDatabaseExpectedTableSpecs(currentSnapshot);

		expect(drizzleSpecs.has("chat.conversations")).toBe(false);
		expect(
			[...currentSpecs.keys()].filter((qualifiedName) => !drizzleSpecs.has(qualifiedName)),
		).toEqual(
			expect.arrayContaining([
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
});
