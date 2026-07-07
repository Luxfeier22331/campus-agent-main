import {
	CopyObjectCommand,
	DeleteObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { S3DiningAttachmentStore } from "../src/attachment-store";
import type { DiningSourceRecord } from "../src/types";

const RECORD: DiningSourceRecord = {
	attachments: [
		{
			fileToken: "file_token_1",
			name: "meal.JPG",
			size: 42,
		},
	],
	campus: "海淀校区",
	comment: "清淡",
	contributorName: "果小生",
	dishName: "金汤鱼粉",
	hallName: "第一食堂",
	paidPriceLabel: "12 元",
	rating: 4,
	sourceRecordId: "rec_safe",
	stallName: "鱼粉",
};

describe("S3 dining attachment store", () => {
	it("publishes images only after checking the moderation object URL", async () => {
		const send = vi.fn(async (_command: CopyObjectCommand | DeleteObjectCommand | PutObjectCommand) => undefined);
		const imageModerator = { checkImage: vi.fn(async () => ({ status: "safe" as const })) };
		const signedUrlFor = vi.fn(async () => "https://signed.example.test/moderation/rec_safe-1.jpg");
		const store = new S3DiningAttachmentStore({
			bucket: "campus-dining-public",
			downloader: {
				downloadAttachment: vi.fn(async () => new Uint8Array([1, 2, 3])),
			},
			imageModerator,
			publicBaseUrl: "https://assets.example.test/",
			reviewPrefix: "dining/reviews",
			s3: { send },
			signedUrlFor,
		});

		const images = await store.materialize({ record: RECORD });

		expect(send).toHaveBeenCalledTimes(3);
		expect(imageModerator.checkImage).toHaveBeenCalledWith({
			url: "https://signed.example.test/moderation/rec_safe-1.jpg",
		});
		expect(signedUrlFor).toHaveBeenCalledWith({
			bucket: "campus-dining-public",
			key: "dining/reviews-moderation/rec_safe-1.jpg",
		});
		const calls = send.mock.calls as [
			CopyObjectCommand | DeleteObjectCommand | PutObjectCommand,
		][];
		expect(calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
		expect(calls[1]?.[0]).toBeInstanceOf(CopyObjectCommand);
		expect(calls[2]?.[0]).toBeInstanceOf(DeleteObjectCommand);
		expect(images).toEqual([
			{
				alt: "金汤鱼粉评价图片",
				imageId: "dining-review-image:rec_safe:1",
				url: "https://assets.example.test/dining/reviews/rec_safe-1.jpg",
			},
		]);
		expect(JSON.stringify(images)).not.toContain("file_token_1");
	});

	it("does not publish blocked images", async () => {
		const send = vi.fn(async (_command: DeleteObjectCommand | PutObjectCommand) => undefined);
		const store = new S3DiningAttachmentStore({
			bucket: "campus-dining-public",
			downloader: {
				downloadAttachment: vi.fn(async () => new Uint8Array([1, 2, 3])),
			},
			imageModerator: { checkImage: vi.fn(async () => ({ status: "blocked" as const })) },
			publicBaseUrl: "https://assets.example.test/",
			reviewPrefix: "dining/reviews",
			s3: { send },
			signedUrlFor: async () => "https://signed.example.test/moderation/rec_safe-1.jpg",
		});

		await expect(store.materialize({ record: RECORD })).rejects.toThrow(/image moderation blocked/);
		expect(send).toHaveBeenCalledTimes(2);
		expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
		expect(send.mock.calls[1]?.[0]).toBeInstanceOf(DeleteObjectCommand);
	});

	it("deletes moderation images when public copy fails", async () => {
		const send = vi.fn(
			async (command: CopyObjectCommand | DeleteObjectCommand | PutObjectCommand) => {
				if (command instanceof CopyObjectCommand) {
					throw new Error("copy failed");
				}
			},
		);
		const store = new S3DiningAttachmentStore({
			bucket: "campus-dining-public",
			downloader: {
				downloadAttachment: vi.fn(async () => new Uint8Array([1, 2, 3])),
			},
			imageModerator: { checkImage: vi.fn(async () => ({ status: "safe" as const })) },
			publicBaseUrl: "https://assets.example.test/",
			reviewPrefix: "dining/reviews",
			s3: { send },
			signedUrlFor: async () => "https://signed.example.test/moderation/rec_safe-1.jpg",
		});

		await expect(store.materialize({ record: RECORD })).rejects.toThrow(/copy failed/);
		expect(send).toHaveBeenCalledTimes(3);
		expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
		expect(send.mock.calls[1]?.[0]).toBeInstanceOf(CopyObjectCommand);
		expect(send.mock.calls[2]?.[0]).toBeInstanceOf(DeleteObjectCommand);
	});

	it("removes public review images that are no longer referenced", async () => {
		const send = vi.fn(async (command: DeleteObjectCommand | ListObjectsV2Command) => {
			if (command instanceof ListObjectsV2Command) {
				return {
					Contents: [
						{ Key: "dining/reviews/live-1.jpg" },
						{ Key: "dining/reviews/stale-1.jpg" },
					],
				};
			}
			return {};
		});
		const store = new S3DiningAttachmentStore({
			bucket: "campus-dining-public",
			downloader: {
				downloadAttachment: vi.fn(async () => new Uint8Array([1, 2, 3])),
			},
			imageModerator: { checkImage: vi.fn(async () => ({ status: "safe" as const })) },
			publicBaseUrl: "https://assets.example.test/",
			reviewPrefix: "dining/reviews",
			s3: { send },
			signedUrlFor: async () => "https://signed.example.test/moderation/rec_safe-1.jpg",
		});

		await store.removeUnreferencedPublicImages([
			"https://assets.example.test/dining/reviews/live-1.jpg",
		]);

		expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ListObjectsV2Command);
		expect(send.mock.calls[1]?.[0]).toBeInstanceOf(DeleteObjectCommand);
		expect(JSON.stringify(send.mock.calls[1]?.[0])).toContain("stale-1.jpg");
		expect(JSON.stringify(send.mock.calls)).not.toContain("live-1.jpg\",\"Bucket");
	});
});
