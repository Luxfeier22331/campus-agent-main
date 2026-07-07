import { describe, expect, it } from "vitest";

import { loadCatalogPublishConfig, loadCatalogSyncConfig, loadConfig } from "../src/config";

const COMPLETE_ENV = {
	DATABASE_URL: "postgres://postgres:postgres@localhost:5432/campus_agent",
	DINING_LARK_APP_ID: "cli_xxx",
	DINING_LARK_APP_SECRET: "secret",
		DINING_LARK_BASE_TOKEN: "base_token",
		DINING_LARK_CAMPUS_TABLE_ID: "tbl_campus",
		DINING_LARK_DISH_TABLE_ID: "tbl_dish",
		DINING_LARK_HALL_TABLE_ID: "tbl_hall",
		DINING_MODERATION_API_KEY: "moderation-secret",
		DINING_MODERATION_BASE_URL: "https://ai.gitee.com/v1",
		DINING_LARK_REVIEW_TABLE_ID: "tbl_review",
		DINING_LARK_REVIEW_VIEW_ID: "vew_review",
		DINING_LARK_STALL_TABLE_ID: "tbl_stall",
	DINING_OBJECT_STORE_BUCKET: "campus-dining-public",
	DINING_OBJECT_STORE_PUBLIC_BASE_URL: "https://assets.example.test",
	OBJECT_STORE_ACCESS_KEY: "access",
	OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
	OBJECT_STORE_SECRET_KEY: "secret",
} satisfies NodeJS.ProcessEnv;

describe("dining sync config", () => {
	it("loads required Feishu, Postgres, and object-store settings", () => {
			expect(loadConfig(COMPLETE_ENV)).toMatchObject({
				larkAppId: "cli_xxx",
				larkCampusTableId: "tbl_campus",
				larkDishTableId: "tbl_dish",
				larkHallTableId: "tbl_hall",
				larkStallTableId: "tbl_stall",
			moderationApiKey: "moderation-secret",
			moderationBaseUrl: "https://ai.gitee.com/v1",
			moderationImageModel: "nsfw-classifier",
			moderationTextModel: "Security-semantic-filtering",
			moderationTimeoutMs: 10_000,
			objectStoreEndpoint: "http://127.0.0.1:9000",
			objectStoreRegion: "us-east-1",
			objectStoreReviewPrefix: "dining/reviews",
			postgresUrl: "postgres://postgres:postgres@localhost:5432/campus_agent",
		});
	});

	it("fails closed when object-store credentials are missing", () => {
		const env: NodeJS.ProcessEnv = { ...COMPLETE_ENV };
		delete env.OBJECT_STORE_SECRET_KEY;

		expect(() => loadConfig(env)).toThrow(/OBJECT_STORE_SECRET_KEY is required/);
	});

	it("fails closed when moderation provider credentials are missing", () => {
		const env: NodeJS.ProcessEnv = { ...COMPLETE_ENV };
		delete env.DINING_MODERATION_API_KEY;

		expect(() => loadConfig(env)).toThrow(/DINING_MODERATION_API_KEY is required/);
	});

	it("fails closed when catalog table ids are missing", () => {
		const env: NodeJS.ProcessEnv = { ...COMPLETE_ENV };
		delete env.DINING_LARK_DISH_TABLE_ID;

		expect(() => loadConfig(env)).toThrow(/DINING_LARK_DISH_TABLE_ID is required/);
		expect(() => loadCatalogSyncConfig(env)).toThrow(/DINING_LARK_DISH_TABLE_ID is required/);
	});

	it("loads moderation provider overrides", () => {
		expect(
			loadConfig({
				...COMPLETE_ENV,
				DINING_MODERATION_API_KEY: "override-secret",
				DINING_MODERATION_BASE_URL: "https://moderation.example.test/v1",
				DINING_MODERATION_IMAGE_MODEL: "image-filter",
				DINING_MODERATION_TEXT_MODEL: "text-filter",
				DINING_MODERATION_TIMEOUT_MS: "12000",
			}),
		).toMatchObject({
			moderationApiKey: "override-secret",
			moderationBaseUrl: "https://moderation.example.test/v1",
			moderationImageModel: "image-filter",
			moderationTextModel: "text-filter",
			moderationTimeoutMs: 12_000,
		});
	});

	it("loads catalog sync settings without review, moderation, or object-store env", () => {
		expect(
			loadCatalogSyncConfig({
				DATABASE_URL: COMPLETE_ENV.DATABASE_URL,
				DINING_LARK_APP_ID: COMPLETE_ENV.DINING_LARK_APP_ID,
				DINING_LARK_APP_SECRET: COMPLETE_ENV.DINING_LARK_APP_SECRET,
				DINING_LARK_BASE_TOKEN: COMPLETE_ENV.DINING_LARK_BASE_TOKEN,
				DINING_LARK_CAMPUS_TABLE_ID: "tbl_campus",
				DINING_LARK_DISH_TABLE_ID: "tbl_dish",
				DINING_LARK_HALL_TABLE_ID: "tbl_hall",
				DINING_LARK_STALL_TABLE_ID: "tbl_stall",
			}),
		).toMatchObject({
			larkCampusTableId: "tbl_campus",
			larkDishTableId: "tbl_dish",
			larkHallTableId: "tbl_hall",
			larkStallTableId: "tbl_stall",
			postgresUrl: COMPLETE_ENV.DATABASE_URL,
		});
	});

	it("loads catalog publish settings without Feishu, review, moderation, or object-store env", () => {
		expect(
			loadCatalogPublishConfig({
				DATABASE_URL: COMPLETE_ENV.DATABASE_URL,
			}),
		).toMatchObject({
			postgresUrl: COMPLETE_ENV.DATABASE_URL,
		});
	});

	it("fails closed when moderation timeout is invalid", () => {
		expect(() =>
			loadConfig({
				...COMPLETE_ENV,
				DINING_MODERATION_TIMEOUT_MS: "0",
			}),
		).toThrow(/DINING_MODERATION_TIMEOUT_MS must be a positive integer/);
	});
});
