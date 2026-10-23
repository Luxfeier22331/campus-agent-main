// @vitest-environment node

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { createS3DiningFloorplanAssetStore } from "../src/server/dining-floorplan-assets";

describe("Dining floorplan publication assets", () => {
	it("publishes an immutable content-addressed SVG", async () => {
		const send = vi.fn(async (_command: unknown) => ({}));
		const store = createS3DiningFloorplanAssetStore({
			bucket: "campus-agent-derived",
			client: { send } as never,
		});
		const digest = "c".repeat(64);

		await expect(
			store.putSvg({ sha256: `sha256:${digest}`, svgMarkup: "<svg></svg>" }),
		).resolves.toBeUndefined();
		const command = send.mock.calls[0]?.[0];
		expect(command).toBeInstanceOf(PutObjectCommand);
		expect((command as PutObjectCommand).input).toMatchObject({
			Bucket: "campus-agent-derived",
			IfNoneMatch: "*",
			Key: `dining/floorplans/${digest}.svg`,
		});
		expect((command as PutObjectCommand).input.Metadata).toBeUndefined();
	});

	it("reuses an object that already exists at the same digest", async () => {
		const send = vi.fn(async (_command: unknown) => {
			throw Object.assign(new Error("Precondition failed"), {
				$metadata: { httpStatusCode: 412 },
			});
		});
		const store = createS3DiningFloorplanAssetStore({
			bucket: "campus-agent-derived",
			client: { send } as never,
		});

		await expect(
			store.putSvg({ sha256: `sha256:${"d".repeat(64)}`, svgMarkup: "<svg></svg>" }),
		).resolves.toBeUndefined();
		expect(send).toHaveBeenCalledOnce();
	});
});
