import { CopyObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { DINING_IMAGE_MAX_BYTES, S3DiningAttachmentStore } from "../src/attachment-store.ts";
import type { DiningSourceRecord } from "../src/types.ts";

const RECORD: DiningSourceRecord = {
	attachments: [{ fileToken: "file_token_1", name: "meal.PNG", size: 42 }],
	campus: "海淀校区",
	comment: "清淡",
	contributorName: "果小生",
	dishName: "金汤鱼粉",
	hallName: "第一食堂",
	paidPriceLabel: "12 元",
	rating: 4,
	sourceRecordId: "rec_safe",
	stallName: "鱼粉",
	submittedAt: "2026-07-01T08:00:00.000Z",
};

describe("S3 dining attachment store", () => {
	it("normalizes, quarantines, moderates, and publishes by content hash", async () => {
		const source = new Uint8Array(
			await sharp({
				create: { background: "#d45500", channels: 3, height: 24, width: 32 },
			})
				.png()
				.toBuffer(),
		);
		const send = vi.fn(async (_command: CopyObjectCommand | PutObjectCommand) => undefined);
		const imageModerator = { checkImage: vi.fn(async () => ({ status: "safe" as const })) };
		const signedUrlFor = vi.fn(async () => "https://signed.example.test/quarantine");
		const store = new S3DiningAttachmentStore({
			bucket: "campus-dining-media",
			downloader: { downloadAttachment: vi.fn(async () => source) },
			imageModerator,
			publicEndpoint: "https://assets.example.test/",
			s3: { send },
			signedUrlFor,
		});

		const images = await store.materialize({ record: RECORD, runId: "run:unsafe/path" });

		expect(send).toHaveBeenCalledTimes(2);
		const put = send.mock.calls[0]?.[0];
		const copy = send.mock.calls[1]?.[0];
		expect(put).toBeInstanceOf(PutObjectCommand);
		expect(copy).toBeInstanceOf(CopyObjectCommand);
		expect(put?.input).toMatchObject({
			Bucket: "campus-dining-media",
			ContentType: "image/webp",
			Key: expect.stringMatching(/^quarantine\/reviews\/run_unsafe_path\/[a-f0-9]{64}\.webp$/),
		});
		expect(copy?.input).toMatchObject({
			Bucket: "campus-dining-media",
			Key: expect.stringMatching(/^public\/reviews\/sha256\/[a-f0-9]{64}\.webp$/),
		});
		expect(signedUrlFor).toHaveBeenCalledWith({
			bucket: "campus-dining-media",
			key: put?.input.Key,
		});
		expect(imageModerator.checkImage).toHaveBeenCalledWith({
			url: "https://signed.example.test/quarantine",
		});
		expect(images).toEqual([
			{
				alt: "金汤鱼粉评价图片",
				imageId: expect.stringMatching(/^dining-review-image:sha256:[a-f0-9]{64}$/),
				url: expect.stringMatching(
					/^https:\/\/assets\.example\.test\/campus-dining-media\/public\/reviews\/sha256\/[a-f0-9]{64}\.webp$/,
				),
			},
		]);
		expect(JSON.stringify(images)).not.toContain("file_token_1");
	}, 15_000);

	it("leaves blocked objects private for lifecycle expiration", async () => {
		const source = new Uint8Array(
			await sharp({ create: { background: "white", channels: 3, height: 2, width: 2 } })
				.jpeg()
				.toBuffer(),
		);
		const send = vi.fn(async (_command: CopyObjectCommand | PutObjectCommand) => undefined);
		const store = new S3DiningAttachmentStore({
			bucket: "campus-dining-media",
			downloader: { downloadAttachment: vi.fn(async () => source) },
			imageModerator: { checkImage: vi.fn(async () => ({ status: "blocked" as const })) },
			publicEndpoint: "https://assets.example.test",
			s3: { send },
			signedUrlFor: async () => "https://signed.example.test/quarantine",
		});

		await expect(store.materialize({ record: RECORD, runId: "run-1" })).rejects.toMatchObject({
			reason: "image_moderation_blocked",
		});
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
	});

	it("rejects oversized declarations and invalid image bodies before publication", async () => {
		const attachment = RECORD.attachments[0];
		if (!attachment) {
			throw new Error("Dining attachment fixture is missing.");
		}
		const downloadAttachment = vi.fn(async () => new Uint8Array([1, 2, 3]));
		const store = new S3DiningAttachmentStore({
			bucket: "campus-dining-media",
			downloader: { downloadAttachment },
			imageModerator: { checkImage: vi.fn(async () => ({ status: "safe" as const })) },
			publicEndpoint: "https://assets.example.test",
			s3: { send: vi.fn(async () => undefined) },
			signedUrlFor: async () => "https://signed.example.test/quarantine",
		});

		await expect(
			store.materialize({
				record: {
					...RECORD,
					attachments: [{ ...attachment, size: DINING_IMAGE_MAX_BYTES + 1 }],
				},
				runId: "run-1",
			}),
		).rejects.toMatchObject({ reason: "image_too_large" });
		expect(downloadAttachment).not.toHaveBeenCalled();

		await expect(store.materialize({ record: RECORD, runId: "run-2" })).rejects.toMatchObject({
			reason: "image_decode_failed",
		});
	});
});
