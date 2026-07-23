import { createHash } from "node:crypto";

import { CopyObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";

import type { DiningImageModerationInput } from "./moderation.ts";
import type { DiningReviewImage, DiningSourceRecord, ModerationResult } from "./types.ts";

export const DINING_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const DINING_IMAGE_MAX_PIXELS = 25_000_000;
const DINING_IMAGE_MAX_EDGE = 2_048;
const DINING_IMAGE_WEBP_QUALITY = 82;
const SUPPORTED_INPUT_FORMATS = new Set(["jpeg", "png", "webp"]);

export interface AttachmentDownloader {
	downloadAttachment(fileToken: string, maxBytes: number): Promise<Uint8Array>;
}

export interface DiningImageModerator {
	checkImage(input: DiningImageModerationInput): Promise<ModerationResult>;
}

export interface S3DiningAttachmentStoreConfig {
	bucket: string;
	downloader: AttachmentDownloader;
	imageModerator: DiningImageModerator;
	publicEndpoint: string;
	s3: Pick<S3Client, "send">;
	signedUrlFor: (input: { bucket: string; key: string }) => Promise<string>;
}

export class DiningAttachmentRejectedError extends Error {
	readonly reason: string;

	constructor(reason: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "DiningAttachmentRejectedError";
		this.reason = reason;
	}
}

export class S3DiningAttachmentStore {
	private readonly config: S3DiningAttachmentStoreConfig;

	constructor(config: S3DiningAttachmentStoreConfig) {
		this.config = config;
	}

	async materialize(input: {
		record: DiningSourceRecord;
		runId: string;
	}): Promise<DiningReviewImage[]> {
		const images: DiningReviewImage[] = [];
		for (const attachment of input.record.attachments) {
			if (attachment.size > DINING_IMAGE_MAX_BYTES) {
				throw new DiningAttachmentRejectedError(
					"image_too_large",
					`Dining review image exceeds the ${DINING_IMAGE_MAX_BYTES} byte limit.`,
				);
			}
			const source = await this.config.downloader.downloadAttachment(
				attachment.fileToken,
				DINING_IMAGE_MAX_BYTES,
			);
			const body = await normalizeImage(source);
			const digest = createHash("sha256").update(body).digest("hex");
			const quarantineKey = `quarantine/reviews/${safePathSegment(input.runId)}/${digest}.webp`;
			const publicKey = `public/reviews/sha256/${digest}.webp`;
			await this.putObject({ body, key: quarantineKey });
			const moderationUrl = await this.config.signedUrlFor({
				bucket: this.config.bucket,
				key: quarantineKey,
			});
			const moderation = await this.config.imageModerator.checkImage({ url: moderationUrl });
			if (moderation.status !== "safe") {
				throw new DiningAttachmentRejectedError(
					"image_moderation_blocked",
					"Dining review image moderation blocked publication.",
				);
			}
			await this.copyObject({ sourceKey: quarantineKey, targetKey: publicKey });
			images.push({
				alt: `${input.record.dishName}评价图片`,
				imageId: `dining-review-image:sha256:${digest}`,
				url: this.publicUrlFor(publicKey),
			});
		}
		return images;
	}

	private async putObject(input: { body: Uint8Array; key: string }): Promise<void> {
		await this.config.s3.send(
			new PutObjectCommand({
				Body: input.body,
				Bucket: this.config.bucket,
				ContentType: "image/webp",
				Key: input.key,
			}),
		);
	}

	private async copyObject(input: { sourceKey: string; targetKey: string }): Promise<void> {
		await this.config.s3.send(
			new CopyObjectCommand({
				Bucket: this.config.bucket,
				ContentType: "image/webp",
				CopySource: encodeURI(`${this.config.bucket}/${input.sourceKey}`),
				Key: input.targetKey,
				MetadataDirective: "REPLACE",
			}),
		);
	}

	private publicUrlFor(key: string): string {
		return `${this.config.publicEndpoint.replace(/\/$/, "")}/${this.config.bucket}/${key}`;
	}
}

async function normalizeImage(source: Uint8Array): Promise<Uint8Array> {
	try {
		const image = sharp(source, {
			failOn: "warning",
			limitInputPixels: DINING_IMAGE_MAX_PIXELS,
		});
		const metadata = await image.metadata();
		if (!(metadata.format && SUPPORTED_INPUT_FORMATS.has(metadata.format))) {
			throw new DiningAttachmentRejectedError(
				"image_format_invalid",
				"Dining review image must be JPEG, PNG, or WebP.",
			);
		}
		const body = await image
			.rotate()
			.resize({
				fit: "inside",
				height: DINING_IMAGE_MAX_EDGE,
				width: DINING_IMAGE_MAX_EDGE,
				withoutEnlargement: true,
			})
			.webp({ quality: DINING_IMAGE_WEBP_QUALITY })
			.toBuffer();
		return new Uint8Array(body);
	} catch (error) {
		if (error instanceof DiningAttachmentRejectedError) {
			throw error;
		}
		throw new DiningAttachmentRejectedError(
			"image_decode_failed",
			"Dining review image could not be decoded within the media policy.",
			{ cause: error },
		);
	}
}

function safePathSegment(value: string): string {
	return value.replaceAll(/[^A-Za-z0-9._-]/g, "_");
}
