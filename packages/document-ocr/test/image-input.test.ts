import { createJimp } from "@jimp/core";
import bmp from "@jimp/js-bmp";
import gif from "@jimp/js-gif";
import png from "@jimp/js-png";
import { expect, it } from "vitest";
import { normalizeImageInput } from "../src/image-input.ts";

const Jimp = createJimp({ formats: [bmp, gif, png] });

it.each([
	["image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
	["image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])],
] as const)("passes %s through unchanged", async (contentType, bytes) => {
	const result = await normalizeImageInput(bytes);
	expect(result.contentType).toBe(contentType);
	expect(result.bytes).toBe(bytes);
});

it.each(["image/gif", "image/bmp"] as const)(
	"converts %s pixels into a static PNG",
	async (mime) => {
		const source = new Jimp({ width: 2, height: 3, color: 0xff0000ff });
		const result = await normalizeImageInput(await source.getBuffer(mime));
		expect(result.contentType).toBe("image/png");
		const decoded = await Jimp.read(Buffer.from(result.bytes));
		expect(decoded.bitmap.width).toBe(2);
		expect(decoded.bitmap.height).toBe(3);
		expect([...decoded.bitmap.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
	},
);

it("rejects unsupported input", async () => {
	await expect(normalizeImageInput(new TextEncoder().encode("<svg/>"))).rejects.toThrow(
		/JPEG, PNG, GIF or BMP/,
	);
});
