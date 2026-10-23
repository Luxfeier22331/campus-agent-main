import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { createS3Object } from "../src/s3-create-object.ts";

const body = new TextEncoder().encode("source-bytes");
const identity = { byteSize: body.byteLength, contentSha256: "a".repeat(64) };
const preconditionFailed = Object.assign(new Error("already exists"), { name: "PreconditionFailed" });

describe("internal portal collection S3 create-object", () => {
	it("creates a missing object without reading it back", async () => {
		const send = vi.fn(async (_command: unknown) => ({}));

		await expect(
			createS3Object({
				body,
				bucket: "campus-agent-source",
				client: { send } as never,
				contentType: "application/octet-stream",
				key: "internal_portal/resources/sha256/example",
			}),
		).resolves.toBe("created");
		expect(send).toHaveBeenCalledOnce();
		const input = (send.mock.calls[0]?.[0] as PutObjectCommand).input;
		expect(input.IfNoneMatch).toBe("*");
		expect(input.Metadata).toBeUndefined();
	});

	it("accepts an existing content-addressed object without a HEAD", async () => {
		const send = vi.fn(async () => {
			throw preconditionFailed;
		});

		await expect(
			createS3Object({
				body,
				bucket: "campus-agent-source",
				client: { send } as never,
				contentType: "application/octet-stream",
				key: "internal_portal/resources/sha256/example",
			}),
		).resolves.toBe("existing");
		expect(send).toHaveBeenCalledOnce();
	});

	it.each([
		{ existing: identity, expected: "existing" },
		{ existing: { ...identity, byteSize: identity.byteSize + 1 }, expected: "collision" },
		{ existing: { ...identity, contentSha256: "b".repeat(64) }, expected: "collision" },
	])("compares a fixed key's identity on conflict ($expected)", async ({ existing, expected }) => {
		const send = vi.fn(async (command: unknown) => {
			if (command instanceof PutObjectCommand) {
				expect(command.input.Metadata).toEqual({ "content-sha256": identity.contentSha256 });
				throw preconditionFailed;
			}
			if (command instanceof HeadObjectCommand) {
				return {
					ContentLength: existing.byteSize,
					Metadata: { "content-sha256": existing.contentSha256 },
				};
			}
			throw new Error("unexpected S3 command");
		});

		const result = createS3Object({
			body,
			bucket: "campus-agent-source",
			client: { send } as never,
			contentType: "application/pdf",
			identity,
			key: "file-releases/646/file",
		});
		if (expected === "existing") {
			await expect(result).resolves.toBe("existing");
		} else {
			await expect(result).rejects.toThrow(
				"object identity collision at s3://campus-agent-source/file-releases/646/file",
			);
		}
	});
});
