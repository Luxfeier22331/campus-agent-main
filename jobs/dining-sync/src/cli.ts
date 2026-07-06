import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createDevDiningOperationsState } from "@campus-agent/dining/domain";

import { S3DiningAttachmentStore } from "./attachment-store";
import {
	buildCatalogObservations,
	buildDiningStateFromCatalogObservations,
} from "./catalog-source";
import { PostgresDiningCatalogSourceObservationStore } from "./catalog-source-store";
import { PostgresDiningCatalogPublisher } from "./catalog-publisher";
import { buildDiningCatalogPublishSummary } from "./catalog-summary";
import {
	loadCatalogImportConfig,
	loadCatalogPublishConfig,
	loadCatalogSyncConfig,
	loadConfig,
} from "./config";
import { CatalogDiningHallResolver } from "./hall-resolver";
import { LarkDiningClient } from "./lark-client";
import { GiteeAiDiningModerator } from "./moderation";
import { PostgresDiningReviewPublisher } from "./postgres-publisher";
import { PostgresDiningPublishedCloseoutVerifier } from "./published-closeout";
import { PostgresDiningSourceObservationStore } from "./source-observation-store";
import { runDiningSync } from "./sync-pipeline";

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
	if (command === "catalog-observations") {
		await syncCatalogObservations();
		return;
	}
	if (command === "publish-catalog") {
		await publishCatalogFromFeishu();
		return;
	}
	if (command === "publish-catalog-from-observations") {
		await publishCatalogFromStoredObservations();
		return;
	}
	if (command === "verify-published") {
		await verifyPublishedDining();
		return;
	}
	throw new Error(
		"Usage: pnpm sync [sync-all|run|catalog-observations|publish-catalog|publish-catalog-from-observations|import-dev-seed|verify-published]",
	);
}

async function syncAll() {
	await publishCatalogFromFeishu();
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
		hallResolver: CatalogDiningHallResolver.fromObservations(
			await observationStore.listActiveFeishuCatalogObservations(),
		),
		moderator,
		observationStore,
		publisher: new PostgresDiningReviewPublisher(config.postgresUrl),
		records,
		sourceIdentity: {
			baseToken: config.larkBaseToken,
			reviewTableId: config.larkReviewTableId,
		},
	});
	console.log(JSON.stringify(report, null, 2));
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

async function publishCatalogFromFeishu() {
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
	const store = new PostgresDiningCatalogSourceObservationStore({
		databaseUrl: config.postgresUrl,
	});
	await store.upsertFeishuCatalogObservations(observations, {
		baseToken: config.larkBaseToken,
		campusTableId: config.larkCampusTableId,
		dishTableId: config.larkDishTableId,
		hallTableId: config.larkHallTableId,
		stallTableId: config.larkStallTableId,
	});
	await publishCatalogFromObservations({
		observations: await store.listActiveFeishuCatalogObservations(),
		postgresUrl: config.postgresUrl,
	});
}

async function publishCatalogFromStoredObservations() {
	const config = loadCatalogPublishConfig();
	const store = new PostgresDiningCatalogSourceObservationStore({
		databaseUrl: config.postgresUrl,
	});
	await publishCatalogFromObservations({
		observations: await store.listActiveFeishuCatalogObservations(),
		postgresUrl: config.postgresUrl,
	});
}

async function publishCatalogFromObservations(input: {
	observations: ReturnType<typeof buildCatalogObservations>;
	postgresUrl: string;
}) {
	const state = buildDiningStateFromCatalogObservations({
		observations: input.observations,
		source: {
			label: "Feishu 食堂采集",
			updatedAt: new Date().toISOString(),
		},
	});
	await new PostgresDiningCatalogPublisher({ databaseUrl: input.postgresUrl }).publishCatalog(state);
	console.log(JSON.stringify(buildDiningCatalogPublishSummary(state, "catalog_published"), null, 2));
}

async function importDevSeed() {
	const config = loadCatalogImportConfig();
	if (config.appEnvironment === "production") {
		throw new Error("Refusing to import dining dev seed in production.");
	}
	const publisher = new PostgresDiningCatalogPublisher({ databaseUrl: config.postgresUrl });
	const state = createDevDiningOperationsState();
	await publisher.refreshCatalog(state);
	console.log(JSON.stringify(buildDiningCatalogPublishSummary(state, "dev_seed_imported"), null, 2));
}

async function verifyPublishedDining() {
	const config = loadCatalogPublishConfig();
	const summary = await new PostgresDiningPublishedCloseoutVerifier({
		databaseUrl: config.postgresUrl,
	}).verify();
	console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
