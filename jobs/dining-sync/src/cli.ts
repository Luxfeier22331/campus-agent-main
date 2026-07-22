import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createDevDiningSeed } from "@campus-agent/dining/domain";

import { S3DiningAttachmentStore } from "./attachment-store.ts";
import { buildCatalogObservations } from "./catalog-source.ts";
import { PostgresDiningCatalogSourceObservationStore } from "./catalog-source-store.ts";
import {
	loadCatalogImportConfig,
	loadCatalogSyncConfig,
	loadConfig,
	loadMigrationConfig,
} from "./config.ts";
import { LarkDiningClient } from "./lark-client.ts";
import { GiteeAiDiningModerator } from "./moderation.ts";
import { migrateDining } from "./migrate.ts";
import { PostgresDiningDevSeedImporter } from "./dev-seed-importer.ts";
import { PostgresDiningReviewPublisher } from "./postgres-publisher.ts";
import { PostgresDiningPublishedCloseoutVerifier } from "./published-closeout.ts";
import { PostgresDiningPublishedSnapshotReader } from "./published-snapshot-reader.ts";
import { PublishedDiningReviewResolver } from "./review-resolver.ts";
import { processDiningReviewRechecks } from "./review-recheck.ts";
import { PostgresDiningSourceObservationStore } from "./source-observation-store.ts";
import { runDiningSync } from "./sync-pipeline.ts";

async function main() {
	const command = process.argv[2] ?? "run";
	if (command === "run") {
		await runReviewSync();
		return;
	}
	if (command === "sync-all") {
		await syncAll();
		return;
	}
	if (command === "import-dev-seed") {
		await importDevSeed();
		return;
	}
	if (command === "migrate") {
		await migrateDining(loadMigrationConfig().postgresUrl);
		return;
	}
	if (command === "catalog-observations") {
		await syncCatalogObservations();
		return;
	}
	if (command === "verify-published") {
		await verifyPublishedDining();
		return;
	}
	throw new Error(
		"Usage: pnpm sync [sync-all|run|catalog-observations|import-dev-seed|verify-published|migrate]",
	);
}

async function syncAll() {
	await syncCatalogObservations();
	await runReviewSync();
}

async function runReviewSync() {
	const config = loadConfig();
	const lark = new LarkDiningClient({
		appId: config.larkAppId,
		appSecret: config.larkAppSecret,
		baseToken: config.larkBaseToken,
		campusTableId: config.larkCampusTableId,
		dishTableId: config.larkDishTableId,
		hallTableId: config.larkHallTableId,
		reviewTableId: config.larkReviewTableId,
		reviewViewId: config.larkReviewViewId,
		stallTableId: config.larkStallTableId,
	});
	const records = await lark.listReviewRecords();
	const moderator = new GiteeAiDiningModerator({
		apiKey: config.moderationApiKey,
		baseUrl: config.moderationBaseUrl,
		imageModel: config.moderationImageModel,
		textModel: config.moderationTextModel,
		timeoutMs: config.moderationTimeoutMs,
	});
	const s3 = new S3Client({
		credentials: {
			accessKeyId: config.objectStoreAccessKey,
			secretAccessKey: config.objectStoreSecretKey,
		},
		endpoint: config.objectStoreEndpoint,
		forcePathStyle: true,
		region: config.objectStoreRegion,
	});
	const attachmentStore = new S3DiningAttachmentStore({
		bucket: config.objectStoreBucket,
		downloader: lark,
		imageModerator: moderator,
		publicBaseUrl: config.objectStorePublicBaseUrl,
		reviewPrefix: config.objectStoreReviewPrefix,
		s3,
		signedUrlFor: async ({ bucket, key }) =>
			getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 }),
	});
	const observationStore = new PostgresDiningSourceObservationStore({ databaseUrl: config.postgresUrl });
	const report = await runDiningSync({
		attachmentStore,
		moderator,
		observationStore,
		publisher: new PostgresDiningReviewPublisher(config.postgresUrl),
		records,
		reviewResolver: new PublishedDiningReviewResolver(
			await new PostgresDiningPublishedSnapshotReader(config.postgresUrl).read(),
		),
		sourceIdentity: {
			baseToken: config.larkBaseToken,
			reviewTableId: config.larkReviewTableId,
		},
	});
	const rechecks = await processDiningReviewRechecks({ databaseUrl: config.postgresUrl, moderator });
	console.log(JSON.stringify({ ...report, rechecks }, null, 2));
}

async function syncCatalogObservations() {
	const config = loadCatalogSyncConfig();
	const lark = new LarkDiningClient({
		appId: config.larkAppId,
		appSecret: config.larkAppSecret,
		baseToken: config.larkBaseToken,
		campusTableId: config.larkCampusTableId,
		dishTableId: config.larkDishTableId,
		hallTableId: config.larkHallTableId,
		stallTableId: config.larkStallTableId,
	});
	const records = await lark.listCatalogRecords();
	const observations = buildCatalogObservations(records, new Date());
	const report = await new PostgresDiningCatalogSourceObservationStore({
		databaseUrl: config.postgresUrl,
	}).upsertFeishuCatalogObservations(observations, {
		baseToken: config.larkBaseToken,
		campusTableId: config.larkCampusTableId,
		dishTableId: config.larkDishTableId,
		hallTableId: config.larkHallTableId,
		stallTableId: config.larkStallTableId,
	});
	console.log(
		JSON.stringify(
			{
				acceptedCount: report.acceptedCount,
				blockedCount: report.blockedCount,
				runId: report.runId,
				status: "catalog_observations_synced",
				staleCount: report.staleCount,
				totalCount: report.totalCount,
			},
			null,
			2,
		),
	);
}

async function importDevSeed() {
	const config = loadCatalogImportConfig();
	if (config.appEnvironment === "production") {
		throw new Error("Refusing to import dining dev seed in production.");
	}
	const seed = createDevDiningSeed();
	await new PostgresDiningDevSeedImporter(config.postgresUrl).import(seed);
	console.log(JSON.stringify({
		hallCount: seed.draft.halls.length,
		offeringCount: seed.draft.menuOfferings.length,
		reviewCount: seed.reviews.length,
		status: "dev_seed_imported",
	}, null, 2));
}

async function verifyPublishedDining() {
	const config = loadCatalogImportConfig();
	const summary = await new PostgresDiningPublishedCloseoutVerifier({
		databaseUrl: config.postgresUrl,
	}).verify();
	console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
