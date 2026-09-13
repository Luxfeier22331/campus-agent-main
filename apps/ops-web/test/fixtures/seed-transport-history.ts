// Explicit local acceptance helper, never imported by bootstrap or runtime.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { normalizeNoticeContent } from "@campus-agent/notices";
import { Client } from "pg";
import {
	MAY_DAY_PERIODS,
	PERMANENT_INCREASE_PERIODS,
	SUBWAY_SUSPENSIONS,
	SUMMER_PERIODS,
} from "../../../../packages/domains/transport/test/fixtures/history";

const root = resolve(import.meta.dirname, "../../../..");
const sourceDir = process.argv[2];
if (!sourceDir) {
	throw new Error(
		"Usage: pnpm exec tsx test/fixtures/seed-transport-history.ts <saved-source-directory>",
	);
}
loadEnvFile(resolve(root, "apps/app-api/.env.local"));
loadEnvFile(resolve(root, "apps/ops-web/.env.local"));
const profile = JSON.parse(readFileSync(resolve(root, "var/dev/profile.json"), "utf8"));
const dbUrl = new URL(requiredEnv("APP_API_SCHEMA_DATABASE_URL"));
const endpoint = new URL(requiredEnv("OBJECT_STORE_ENDPOINT"));
if (
	dbUrl.hostname !== "127.0.0.1" ||
	dbUrl.pathname !== `/${profile.databaseName}` ||
	process.env.OBJECT_STORE_BUCKET_DERIVED !== profile.bucketName ||
	endpoint.hostname !== "127.0.0.1"
) {
	throw new Error("Only this worktree's local PostgreSQL and object store are supported.");
}
const db = new Client({ connectionString: dbUrl.toString() });
const objectStore = new S3Client({
	endpoint: endpoint.toString(),
	region: "us-east-1",
	forcePathStyle: true,
	credentials: {
		accessKeyId: requiredEnv("OBJECT_STORE_DERIVED_ACCESS_KEY"),
		secretAccessKey: requiredEnv("OBJECT_STORE_DERIVED_SECRET_KEY"),
	},
});
const samples = JSON.parse(
	readFileSync(resolve(sourceDir, "additional-schedule-samples.json"), "utf8"),
);
// Consume every saved notice that can be imported without inventing attachment
// contents. Notices without a complete timetable remain notice-only records.
const notices = [
	349168, 349494, 351862, 353903, 354343, 355512, 355867, 356341, 357813, 358327, 245395,
].map((noticeId) => {
	const file = resolve(sourceDir, `internal_portal_notices_${noticeId}.json`);
	const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
	const sample = samples.find((entry: { notice_id: number }) => entry.notice_id === noticeId);
	const title = raw?.notice_title ?? sample?.title;
	if (!title) {
		throw new Error(`Missing saved notice ${noticeId}`);
	}
	const content = raw
		? normalizeNoticeContent({
				html: raw.notice_content_html,
				title,
				portalHost: "my.muc.edu.cn",
			})
		: { contentHtml: sample.content_html, contentText: sample.content_text, images: [] };
	const images = content.images.map((image) => {
		const body = readFileSync(
			resolve(sourceDir, `internal_portal_notices_${noticeId}_images_${image.sourceOrdinal}`),
		);
		return {
			ordinal: image.ordinal,
			body,
			sha: createHash("sha256").update(body).digest("hex"),
			contentType: body[0] === 0x89 ? "image/png" : "image/jpeg",
		};
	});
	if (!raw && /notice-asset:image:/u.test(content.contentHtml ?? "")) {
		throw new Error(`Raw image source required for ${noticeId}`);
	}
	return {
		noticeId,
		title,
		released: raw ? `${raw.notice_release_time.replace(" ", "T")}:00+08:00` : sample.released_at,
		content,
		images,
	};
});
await db.connect();
try {
	await db.query("begin");
	await db.query(
		"insert into notices.notice_types(notice_type,name) values(5,'通知公告') on conflict do nothing",
	);
	for (const notice of notices) {
		await db.query(
			`insert into notices.notices(notice_id,notice_type,title,released_at,is_external,content_html,content_text,category,is_published)
			values($1,5,$2,$3,false,$4,$5,'campus_operations',true)
			on conflict(notice_id) do update set title=excluded.title,released_at=excluded.released_at,content_html=excluded.content_html,content_text=excluded.content_text,category=excluded.category,is_published=true`,
			[
				notice.noticeId,
				notice.title,
				notice.released,
				notice.content.contentHtml,
				notice.content.contentText,
			],
		);
		for (const image of notice.images) {
			await objectStore.send(
				new PutObjectCommand({
					Bucket: requiredEnv("OBJECT_STORE_BUCKET_DERIVED"),
					Key: `notices/assets/sha256/${image.sha}`,
					Body: image.body,
					ContentType: image.contentType,
				}),
			);
			await db.query(
				`insert into notices.notice_assets(notice_id,asset_kind,ordinal,byte_size,content_sha256,content_type)
			values($1,'image',$2,$3,$4,$5) on conflict(notice_id,asset_kind,ordinal) do update set byte_size=excluded.byte_size,content_sha256=excluded.content_sha256,content_type=excluded.content_type`,
				[notice.noticeId, image.ordinal, image.body.length, image.sha, image.contentType],
			);
		}
	}
	const historical = [
		...MAY_DAY_PERIODS,
		...SUMMER_PERIODS,
		...PERMANENT_INCREASE_PERIODS,
		...SUBWAY_SUSPENSIONS,
	];
	for (const fixture of historical) {
		const p = fixture.input;
		// Reuse the existing May Day periods; do not duplicate or rewrite them.
		const existing =
			p.validFrom === "2026-04-28"
				? (
						await db.query(
							"select schedule_id from transport.schedule_periods where route_id=$1 and valid_from=$2 and valid_to=$3",
							[p.routeId, p.validFrom, p.validTo],
						)
					).rows[0]
				: null;
		const id = existing?.schedule_id ?? fixture.scheduleId;
		if (!existing) {
			await db.query(
				`insert into transport.schedule_periods(schedule_id,route_id,valid_from,valid_to,weekdays,status,boarding_point_override,drop_off_point_override,note,created_at,updated_at,updated_by)
			values($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now(),'local:transport-history') on conflict(schedule_id) do nothing`,
				[
					id,
					p.routeId,
					p.validFrom,
					p.validTo,
					p.weekdays,
					p.status,
					p.boardingPointOverride,
					p.dropOffPointOverride,
					p.note,
				],
			);
			for (const [index, item] of p.items.entries()) {
				if (item.kind !== "fixed") {
					throw new Error("History sample must have fixed times");
				}
				await db.query(
					`insert into transport.schedule_items(item_id,schedule_id,kind,departure_time,rider_type,boarding_point,capacity,note,sort_order)
				values($1,$2,'fixed',$3,$4,$5,$6,$7,$8) on conflict(item_id) do nothing`,
					[
						`${id}:${index}`,
						id,
						item.departureTime,
						item.riderType,
						item.boardingPoint,
						item.capacity,
						item.note,
						item.sortOrder,
					],
				);
			}
		}
		for (const noticeId of fixture.noticeIds) {
			await db.query(
				"insert into transport.schedule_period_notices(schedule_id,notice_id) values($1,$2) on conflict do nothing",
				[id, noticeId],
			);
		}
	}
	await db.query("commit");
	console.log({
		database: profile.databaseName,
		notices: notices.length,
		images: notices.reduce((n, x) => n + x.images.length, 0),
		historicalPeriods: historical.length,
		autumnBaseline: "unchanged",
	});
} catch (error) {
	await db.query("rollback");
	throw error;
} finally {
	await db.end();
	objectStore.destroy();
}

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}
