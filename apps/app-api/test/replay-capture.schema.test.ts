// @vitest-environment node

import { describe, expect, it } from "vitest";

import { appApiSchema, replayPacketIndex } from "../src/db/schema";
import { appApiOwnedSchema } from "../src/db/schema/owned";
import { replayPacketAccessAudit } from "../src/db/schema/replay-capture";

describe("replay capture schema", () => {
	it("exports only replay packet safe metadata through app-api schema truth", () => {
		expect(appApiSchema.replayPacketIndex).toBe(replayPacketIndex);
		expect(appApiOwnedSchema.replayPacketIndex).toBe(replayPacketIndex);

		const columnNames = Object.keys(replayPacketIndex);
		expect(columnNames).toEqual(expect.arrayContaining(["objectRef", "objectChecksumSha256"]));
		expect(columnNames).not.toEqual(expect.arrayContaining(["renderedMessages"]));
		expect(columnNames).not.toEqual(expect.arrayContaining(["providerRequestBody"]));
		expect(columnNames).not.toEqual(expect.arrayContaining(["providerResponseBody"]));
		expect(columnNames).not.toEqual(expect.arrayContaining(["selectedMemoryContext"]));
		expect(columnNames).not.toEqual(expect.arrayContaining(["selectedEvidencePacket"]));
	});

	it("exports replay packet access audit as safe metadata only", () => {
		const columnNames = Object.keys(replayPacketAccessAudit);
		expect(columnNames).toEqual(
			expect.arrayContaining([
				"accessId",
				"packetId",
				"accessKind",
				"actorPrincipal",
				"occurredAt",
			]),
		);
		expect(columnNames).not.toEqual(expect.arrayContaining(["objectBody"]));
		expect(columnNames).not.toEqual(expect.arrayContaining(["providerRequestBody"]));
		expect(columnNames).not.toEqual(expect.arrayContaining(["providerResponseBody"]));
	});
});
