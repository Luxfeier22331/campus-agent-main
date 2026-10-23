import { createJimp } from "@jimp/core";
import bmp from "@jimp/js-bmp";
import gif from "@jimp/js-gif";
import png from "@jimp/js-png";

const Jimp = createJimp({ formats: [bmp, gif, png] });

export async function normalizeImageInput(bytes: Uint8Array): Promise<{
	bytes: Uint8Array;
	contentType: "image/jpeg" | "image/png";
}> {
	if (isJpeg(bytes)) {
		return { bytes, contentType: "image/jpeg" };
	}
	if (isPng(bytes)) {
		return { bytes, contentType: "image/png" };
	}
	if (isGif(bytes) || isBmp(bytes)) {
		const image = await Jimp.read(Buffer.from(bytes));
		return {
			bytes: new Uint8Array(await image.getBuffer("image/png")),
			contentType: "image/png",
		};
	}
	throw new Error("OCR input must be a JPEG, PNG, GIF or BMP image");
}

function isJpeg(bytes: Uint8Array): boolean {
	return bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isPng(bytes: Uint8Array): boolean {
	return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function isGif(bytes: Uint8Array): boolean {
	const header = new TextDecoder().decode(bytes.slice(0, 6));
	return header === "GIF89a" || header === "GIF87a";
}

function isBmp(bytes: Uint8Array): boolean {
	return bytes[0] === 0x42 && bytes[1] === 0x4d;
}
