import type { DiningImagesBindingLike } from "../../config";
import { AppApiRouteError } from "../../http";
import {
	hasPngSignature,
	inspectJpeg,
	inspectPng,
	invalidDiningPhoto,
} from "./submission-image-container";
import { hasWebpSignature, inspectWebp, stripWebpMetadata } from "./submission-image-webp";
import type { DiningImageProcessor } from "./submission-media";

export const DINING_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const outputMaxDimension = 1600;

function unavailable(): AppApiRouteError {
	return new AppApiRouteError({
		code: "dining_submission_image_unavailable",
		message: "Photo processing is temporarily unavailable.",
		retryable: true,
		status: 503,
	});
}

function inspectInput(bytes: Uint8Array): void {
	if (bytes.length > DINING_PHOTO_MAX_BYTES) {
		throw new AppApiRouteError({
			code: "dining_submission_payload_too_large",
			message: "Photo exceeds the upload size limit.",
			retryable: false,
			status: 413,
		});
	}
	if (hasPngSignature(bytes)) {
		inspectPng(bytes);
	} else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
		inspectJpeg(bytes);
	} else if (hasWebpSignature(bytes)) {
		inspectWebp(bytes);
	} else {
		throw new AppApiRouteError({
			code: "dining_submission_media_unsupported",
			message: "Photo must be a JPEG, PNG, or WebP image.",
			retryable: false,
			status: 415,
		});
	}
}

export function createDiningImageProcessor(
	binding?: DiningImagesBindingLike,
): DiningImageProcessor {
	return {
		async normalize(bytes) {
			inspectInput(bytes);
			if (!binding) {
				throw unavailable();
			}
			let transformed: Uint8Array;
			try {
				// Rely on Images' automatic orientation and avoid a background that would flatten alpha.
				// Real binding orientation/alpha/full-decode acceptance remains an environment check.
				const output = await binding
					.input(new Blob([Uint8Array.from(bytes)]).stream())
					.transform({ width: outputMaxDimension, height: outputMaxDimension, fit: "scale-down" })
					.output({ format: "image/webp" });
				if (output.contentType() !== "image/webp") {
					throw unavailable();
				}
				// Consume the entire transformation; headers or info() do not prove decoding completed.
				transformed = new Uint8Array(await new Response(output.image()).arrayBuffer());
			} catch (error) {
				// The installed Images contract identifies 9412 as invalid image input. Unknown
				// provider codes (including quota/timeouts) must never be blamed on the upload.
				if (error instanceof Error && "code" in error && error.code === 9412) {
					throw invalidDiningPhoto();
				}
				throw unavailable();
			}
			try {
				const container = inspectWebp(transformed);
				if (container.width > outputMaxDimension || container.height > outputMaxDimension) {
					throw unavailable();
				}
				return {
					bytes: stripWebpMetadata(transformed, container),
					width: container.width,
					height: container.height,
				};
			} catch {
				// Invalid output is a processor failure, not user input.
				throw unavailable();
			}
		},
	};
}
