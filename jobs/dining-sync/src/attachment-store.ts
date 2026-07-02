import {
	CopyObjectCommand,
	DeleteObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";

import type { DiningImageModerationInput } from "./moderation";
import type { DiningReviewImage, DiningSourceRecord, ModerationResult } from "./types";

export interface AttachmentDownloader {
	downloadAttachment(fileToken: string): Promise<Uint8Array>;
}

export interface DiningImageModerator {
	checkImage(input: DiningImageModerationInput): Promise<ModerationResult>;
}

export interface S3DiningAttachmentStoreConfig {
	bucket: string;
	downloader: AttachmentDownloader;
	imageModerator: DiningImageModerator;
	publicBaseUrl: string;
	reviewPrefix: string;
	s3: Pick<S3Client, "send">;
	signedUrlFor: (input: { bucket: string; key: string }) => Promise<string>;
}

export class S3DiningAttachmentStore {
	private readonly config: S3DiningAttachmentStoreConfig;

	constructor(config: S3DiningAttachmentStoreConfig) {
		this.config = config;
	}

	async materialize(input: { record: DiningSourceRecord }): Promise<DiningReviewImage[]> {
		const images: DiningReviewImage[] = [];
		for (const [index, attachment] of input.record.attachments.entries()) {
			const body = await this.config.downloader.downloadAttachment(attachment.fileToken);
			const contentType = contentTypeFor(attachment.name);
			if (!isSupportedImageContentType(contentType)) {
				throw new Error(`Unsupported dining review image content type: ${contentType}.`);
			}
			const publicKey = `${this.config.reviewPrefix}/${input.record.sourceRecordId}-${index + 1}${extensionFor(attachment.name)}`;
				const moderationKey = `${this.config.reviewPrefix}-moderation/${input.record.sourceRecordId}-${index + 1}${extensionFor(attachment.name)}`;
				await this.putObject({ body, contentType, key: moderationKey });
				try {
					const moderationUrl = await this.config.signedUrlFor({
						bucket: this.config.bucket,
						key: moderationKey,
					});
					const moderation = await this.config.imageModerator.checkImage({
						url: moderationUrl,
					});
					if (moderation.status !== "safe") {
						throw new Error("Dining review image moderation blocked publication.");
					}
				await this.copyObject({ contentType, sourceKey: moderationKey, targetKey: publicKey });
			} finally {
				await this.deleteObject(moderationKey);
			}
			images.push({
				alt: `${input.record.dishName}评价图片`,
				imageId: `dining-review-image:${input.record.sourceRecordId}:${index + 1}`,
				url: this.publicUrlFor(publicKey),
			});
		}
		return images;
	}

	async removeUnreferencedPublicImages(referencedPublicUrls: string[]): Promise<void> {
		const referencedKeys = new Set(
			referencedPublicUrls.map((url) => this.publicKeyFromUrl(url)).filter((key): key is string => Boolean(key)),
		);
		let continuationToken: string | undefined;
		do {
			const result = await this.config.s3.send(
				new ListObjectsV2Command({
					Bucket: this.config.bucket,
					ContinuationToken: continuationToken,
					Prefix: `${this.config.reviewPrefix}/`,
				}),
			);
			for (const object of result.Contents ?? []) {
				const key = object.Key;
				if (key && !referencedKeys.has(key)) {
					await this.deleteObject(key);
				}
			}
			continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
		} while (continuationToken);
	}

	private async putObject(input: {
		body: Uint8Array;
		contentType: string;
		key: string;
	}): Promise<void> {
		await this.config.s3.send(
			new PutObjectCommand({
				Body: input.body,
				Bucket: this.config.bucket,
				ContentType: input.contentType,
				Key: input.key,
			}),
		);
	}

	private async copyObject(input: {
		contentType: string;
		sourceKey: string;
		targetKey: string;
	}): Promise<void> {
		await this.config.s3.send(
			new CopyObjectCommand({
				Bucket: this.config.bucket,
				ContentType: input.contentType,
				CopySource: `${this.config.bucket}/${input.sourceKey}`,
				Key: input.targetKey,
				MetadataDirective: "REPLACE",
			}),
		);
	}

	private async deleteObject(key: string): Promise<void> {
		await this.config.s3.send(
			new DeleteObjectCommand({
				Bucket: this.config.bucket,
				Key: key,
			}),
		);
	}

	private publicUrlFor(key: string): string {
		return `${this.config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
	}

	private publicKeyFromUrl(url: string): string | null {
		const base = `${this.config.publicBaseUrl.replace(/\/$/, "")}/`;
		return url.startsWith(base) ? url.slice(base.length) : null;
	}
}

function extensionFor(name: string): string {
	const match = /\.[A-Za-z0-9]+$/.exec(name);
	return match ? match[0].toLowerCase() : ".bin";
}

function contentTypeFor(name: string): string {
	const lower = name.toLowerCase();
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
		return "image/jpeg";
	}
	if (lower.endsWith(".png")) {
		return "image/png";
	}
	if (lower.endsWith(".webp")) {
		return "image/webp";
	}
	return "application/octet-stream";
}

function isSupportedImageContentType(contentType: string): boolean {
	return ["image/jpeg", "image/png", "image/webp"].includes(contentType);
}
