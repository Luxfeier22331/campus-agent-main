import { describe, expect, it } from "vitest";
import {
	buildInternalNoticeReadModelEntries,
	checkInternalNoticeReadModelConsistency,
	type InternalNoticeReadModelEntry,
	parseInternalNoticeReadModelEntry,
	rebuildInternalNoticeReadModel,
	repairInternalNoticeReadModelConsistency,
} from "../src/index.ts";

const NOTICE_LEVEL_QUERY = "notice_level_query";
const PROCUREMENT_NOTICE_HISTORY = "procurement_notice_history";
const SERVICE_STATUS_CANDIDATE = "campus_services/service_status_candidate";
const UNSUPPORTED = "unsupported";
const RETAINED = "retained_for_notice_query";
const NO_ADOPTION = "no_adoption";

describe("internal notice read model materialization", () => {
	it("builds queryable notice-level rows and excludes other consumer surfaces", async () => {
		const runtime = createRuntime();

		const rows = await buildInternalNoticeReadModelEntries(runtime.projectionEntries, {
			bucketDerived: "campus-agent-derived",
			objectStore: runtime.objectStore,
			registry: runtime.registry,
		});

		expect(rows.map((row) => row.unit_id)).toEqual(["notice_unit:355222:notice_window"]);
		expect(rows[0]).toMatchObject({
			body_excerpt: "# 中央民族大学丰台校区家具采购项目比选公告\n\n供应商应按要求投标。",
			canonical_markdown_object_key: "campus_notices/documents/internal_notice/355222/canonical.md",
			canonical_url: "https://portal.example.edu/notices/355222",
			entitlement_groups: ["campus_members"],
			policy_projection_version: "phase1-authorization-projection-v1",
			published_at_ts: "2026-04-10T00:00:00+08:00",
			queryable: true,
			source_url: "https://portal.example.edu/notices/355222",
			target_surface: NOTICE_LEVEL_QUERY,
			title: "中央民族大学丰台校区家具采购项目比选公告",
			visibility_level: "restricted",
		});
		expect(rows[0]?.search_text).toContain("家具采购项目");
		expect(rows[0]?.search_text).toContain("投标");
	});

	it("keeps long body tails out of read-model storage", async () => {
		const runtime = createRuntime();
		const longTail = "TAIL_MARKER_SHOULD_NOT_BE_STORED";
		runtime.objectStore.putText(
			"campus-agent-derived",
			"campus_notices/documents/internal_notice/355222/canonical.md",
			`# 采购公告\n\n${"正文".repeat(2200)}\n\n${longTail}`,
		);

		const rows = await buildInternalNoticeReadModelEntries(runtime.projectionEntries, {
			bucketDerived: "campus-agent-derived",
			objectStore: runtime.objectStore,
			registry: runtime.registry,
		});

		expect(rows[0]?.body_excerpt.length).toBeLessThanOrEqual(800);
		expect(rows[0]?.search_text.length).toBeLessThanOrEqual(2000);
		expect(rows[0]?.body_excerpt).not.toContain(longTail);
		expect(rows[0]?.search_text).not.toContain(longTail);
	});

	it("rebuilds selected notice rows without replacing unrelated rows", async () => {
		const runtime = createRuntime();
		const projectionStore = new InMemoryProjectionStore(runtime.projectionEntries);
		const readModelStore = new InMemoryReadModelStore([
			readModelSeed("355222", "stale-unit"),
			readModelSeed("999999", "unrelated-unit"),
		]);

		const rows = await rebuildInternalNoticeReadModel({
			bucketDerived: "campus-agent-derived",
			noticeIds: ["355222"],
			objectStore: runtime.objectStore,
			projectionStore,
			readModelStore,
			registry: runtime.registry,
			sourceCollection: "internal_notice",
			sourceCorpus: "campus_notices",
		});

		expect(rows.map((row) => row.source_notice_id)).toEqual(["355222"]);
		expect(
			readModelStore
				.listByScope("campus_notices", "internal_notice", { noticeIds: ["355222"] })
				.map((row) => row.unit_id),
		).toEqual(["notice_unit:355222:notice_window"]);
		expect(
			readModelStore
				.listByScope("campus_notices", "internal_notice")
				.map((row) => row.source_notice_id)
				.sort(),
		).toEqual(["355222", "999999"]);
	});

	it("fails closed for persistent full-scope rebuilds", async () => {
		const runtime = createRuntime();

		await expect(
			rebuildInternalNoticeReadModel({
				bucketDerived: "campus-agent-derived",
				objectStore: runtime.objectStore,
				projectionStore: new InMemoryProjectionStore(runtime.projectionEntries),
				readModelStore: new InMemoryReadModelStore(),
				registry: runtime.registry,
				sourceCollection: "internal_notice",
				sourceCorpus: "campus_notices",
			}),
		).rejects.toThrow("refusing persistent full-scope internal notice read model rebuild");
	});

	it("checks and repairs selected read-model consistency", async () => {
		const runtime = createRuntime();
		const projectionStore = new InMemoryProjectionStore(runtime.projectionEntries);
		const readModelStore = new InMemoryReadModelStore([
			readModelSeed("355222", "notice_unit:355222:notice_window"),
			readModelSeed("355222", "stale-procurement-unit"),
			readModelSeed("999999", "unrelated-unit"),
		]);

		const report = await repairInternalNoticeReadModelConsistency({
			bucketDerived: "campus-agent-derived",
			noticeIds: ["355222"],
			objectStore: runtime.objectStore,
			projectionStore,
			readModelStore,
			registry: runtime.registry,
			sourceCollection: "internal_notice",
			sourceCorpus: "campus_notices",
		});

		expect(report.before.ok).toBe(false);
		expect(report.after.ok).toBe(true);
		expect(report.rebuilt_count).toBe(1);
		expect(
			readModelStore
				.listByScope("campus_notices", "internal_notice", { noticeIds: ["355222"] })
				.map((row) => row.unit_id),
		).toEqual(["notice_unit:355222:notice_window"]);
	});

	it("parses read-model rows with array fields using zod", () => {
		const parsed = parseInternalNoticeReadModelEntry({
			...readModelSeed("355222", "notice_unit:355222:notice_window"),
			body_excerpt: "短摘要",
			search_text: "短搜索文本",
		});

		expect(parsed.body_excerpt).toBe("短摘要");
		expect(parsed.search_text).toBe("短搜索文本");
		expect(parsed.entitlement_groups).toEqual(["campus_members"]);
	});

	it("reports missing queryable rows and extra rows", async () => {
		const runtime = createRuntime();
		const projectionStore = new InMemoryProjectionStore(runtime.projectionEntries);
		const readModelStore = new InMemoryReadModelStore([
			readModelSeed("355222", "notice_unit:355222:notice_window"),
			readModelSeed("355222", "notice_unit:355222:procurement_notice"),
			readModelSeed("999999", "orphan-unit"),
		]);

		const report = await checkInternalNoticeReadModelConsistency({
			projectionStore,
			readModelStore,
			sourceCollection: "internal_notice",
			sourceCorpus: "campus_notices",
		});

		expect(report.ok).toBe(false);
		expect(report.projection_entry_count).toBe(5);
		expect(report.projection_queryable_count).toBe(1);
		expect(report.read_model_entry_count).toBe(3);
		expect(report.missing_queryable_projection_unit_ids).toEqual([]);
		expect(report.extra_read_model_unit_ids).toEqual([
			"notice_unit:355222:procurement_notice",
			"orphan-unit",
		]);
	});
});

interface ProjectionEntry {
	source_family: string;
	source_corpus: string;
	source_collection: string;
	source_notice_id: string;
	unit_id: string;
	primary_role: string;
	target_surface: string;
	consumption_status: string;
	source_notice_document_id: string;
	source_document_id: string;
	source_attachment_ref_ids: string[];
	source_notice_release_time: string;
	role_metadata: Record<string, unknown>;
	updated_at: string;
}

interface RegistryRecord {
	document_id: string;
	corpus: string;
	collection: string;
	source_uri: string;
	visibility_level: string;
	entitlement_groups: string[];
	policy_projection_version: string;
	published_date: string;
	is_current: boolean;
	canonical_markdown_object_key: string;
}

function createRuntime(): {
	objectStore: InMemoryObjectStore;
	projectionEntries: ProjectionEntry[];
	registry: InMemoryRegistry;
} {
	const records = [
		record("355222", "campus_notices/documents/internal_notice/355222/canonical.md"),
		record("355326", "campus_notices/documents/internal_notice/355326/canonical.md"),
		record("355111", "campus_notices/documents/internal_notice/355111/canonical.md"),
		record("355333", "campus_notices/documents/internal_notice/355333/canonical.md"),
	];
	const objectStore = new InMemoryObjectStore();
	objectStore.putText(
		"campus-agent-derived",
		records[0].canonical_markdown_object_key,
		"# 中央民族大学丰台校区家具采购项目比选公告\n\n供应商应按要求投标。",
	);
	objectStore.putText(
		"campus-agent-derived",
		records[1].canonical_markdown_object_key,
		"# 优秀学生干部拟推荐名单公示\n\n名单略。",
	);
	objectStore.putText(
		"campus-agent-derived",
		records[2].canonical_markdown_object_key,
		"# 关于暑假期间办理就业相关事务的通知\n\n服务时间调整。",
	);
	objectStore.putText(
		"campus-agent-derived",
		records[3].canonical_markdown_object_key,
		"# 关于校园空间示意图的通知\n\n见附件示意图。",
	);
	return {
		objectStore,
		projectionEntries: [
			projectionEntry("355222", "notice_unit:355222:notice_window", {
				primaryRole: "notice_window",
				status: RETAINED,
				surface: NOTICE_LEVEL_QUERY,
				title: "中央民族大学丰台校区家具采购项目比选公告",
			}),
			projectionEntry("355222", "notice_unit:355222:procurement_notice", {
				primaryRole: "procurement_notice",
				status: RETAINED,
				surface: PROCUREMENT_NOTICE_HISTORY,
				title: "中央民族大学丰台校区家具采购项目比选公告",
			}),
			projectionEntry("355326", "notice_unit:355326:roster_publication", {
				primaryRole: "roster_publication",
				status: NO_ADOPTION,
				surface: UNSUPPORTED,
				title: "关于2026年优秀学生干部拟推荐名单公示",
			}),
			projectionEntry("355111", "notice_unit:355111:service_status_override", {
				primaryRole: "service_status_override",
				status: RETAINED,
				surface: SERVICE_STATUS_CANDIDATE,
				title: "关于暑假期间办理就业相关事务的通知",
			}),
			projectionEntry("355333", "notice_unit:355333:multimodal_gap", {
				primaryRole: "notice_window",
				status: "pending_multimodal_processing",
				surface: "multimodal_processing_candidate",
				title: "关于校园空间示意图的通知",
			}),
		],
		registry: new InMemoryRegistry(records),
	};
}

function record(noticeId: string, key: string): RegistryRecord {
	return {
		canonical_markdown_object_key: key,
		collection: "internal_notice",
		corpus: "campus_notices",
		document_id: `notice:example_internal_portal:${noticeId}`,
		entitlement_groups: ["campus_members"],
		is_current: true,
		policy_projection_version: "phase1-authorization-projection-v1",
		published_date: "2026-04-10",
		source_uri: `https://portal.example.edu/notices/${noticeId}`,
		visibility_level: "restricted",
	};
}

function projectionEntry(
	noticeId: string,
	unitId: string,
	input: {
		primaryRole: string;
		status: string;
		surface: string;
		title: string;
	},
): ProjectionEntry {
	return {
		consumption_status: input.status,
		primary_role: input.primaryRole,
		role_metadata: { notice_title: input.title },
		source_attachment_ref_ids: [],
		source_collection: "internal_notice",
		source_corpus: "campus_notices",
		source_document_id: `notice:example_internal_portal:${noticeId}`,
		source_family: "internal_notice_restricted",
		source_notice_document_id: `notice:example_internal_portal:${noticeId}`,
		source_notice_id: noticeId,
		source_notice_release_time: "",
		target_surface: input.surface,
		unit_id: unitId,
		updated_at: "2026-04-10T00:00:00+00:00",
	};
}

function readModelSeed(noticeId: string, unitId: string): InternalNoticeReadModelEntry {
	return {
		attachment_refs: [],
		body_excerpt: "",
		canonical_document_id: `notice:example_internal_portal:${noticeId}`,
		canonical_markdown_object_key: `campus_notices/documents/internal_notice/${noticeId}/canonical.md`,
		canonical_url: "",
		consumption_status: RETAINED,
		effective_at_ts: "",
		entitlement_groups: ["campus_members"],
		expires_at_ts: "",
		policy_projection_version: "",
		primary_role: "notice_window",
		projection_updated_at: "2026-04-10T00:00:00+00:00",
		provenance_refs: [],
		published_at: "2026-04-10",
		published_at_ts: "2026-04-10T00:00:00+08:00",
		queryable: true,
		search_text: `测试通知 ${noticeId}`,
		source_collection: "internal_notice",
		source_corpus: "campus_notices",
		source_family: "internal_notice_restricted",
		source_notice_id: noticeId,
		source_url: `https://portal.example.edu/notices/${noticeId}`,
		target_surface: NOTICE_LEVEL_QUERY,
		title: `测试通知 ${noticeId}`,
		unit_id: unitId,
		updated_at: "2026-04-10T00:00:00+00:00",
		visibility_level: "restricted",
	};
}

class InMemoryObjectStore {
	readonly objects = new Map<string, Uint8Array>();

	async getObject(input: { bucket: string; key: string }): Promise<Uint8Array> {
		const body = this.objects.get(`${input.bucket}/${input.key}`);
		if (!body) {
			throw new Error(`missing object: ${input.bucket}/${input.key}`);
		}
		return body;
	}

	putText(bucket: string, key: string, value: string): void {
		this.objects.set(`${bucket}/${key}`, new TextEncoder().encode(value));
	}
}

class InMemoryRegistry {
	readonly records: RegistryRecord[];

	constructor(records: RegistryRecord[]) {
		this.records = records;
	}

	listByScope(corpus: string, collection: string): RegistryRecord[] {
		return this.records
			.filter((record) => record.corpus === corpus && record.collection === collection)
			.sort((left, right) => left.document_id.localeCompare(right.document_id));
	}
}

class InMemoryProjectionStore {
	readonly records = new Map<string, ProjectionEntry>();

	constructor(records: ProjectionEntry[] = []) {
		for (const record of records) {
			this.records.set(
				`${record.source_corpus}/${record.source_collection}/${record.unit_id}`,
				record,
			);
		}
	}

	listByScope(
		sourceCorpus: string,
		sourceCollection: string,
		input: { noticeIds?: string[] } = {},
	): ProjectionEntry[] {
		const selected = new Set(input.noticeIds ?? []);
		return [...this.records.values()]
			.filter(
				(record) =>
					record.source_corpus === sourceCorpus &&
					record.source_collection === sourceCollection &&
					(selected.size === 0 || selected.has(record.source_notice_id)),
			)
			.sort((left, right) =>
				`${left.source_notice_id}/${left.unit_id}`.localeCompare(
					`${right.source_notice_id}/${right.unit_id}`,
				),
			);
	}
}

class InMemoryReadModelStore {
	readonly records = new Map<string, InternalNoticeReadModelEntry>();

	constructor(records: InternalNoticeReadModelEntry[] = []) {
		this.upsertMany(records);
	}

	upsertMany(records: InternalNoticeReadModelEntry[]): void {
		for (const record of records) {
			this.records.set(
				`${record.source_corpus}/${record.source_collection}/${record.unit_id}`,
				record,
			);
		}
	}

	replaceNotices(
		sourceCorpus: string,
		sourceCollection: string,
		noticeIds: string[],
		records: InternalNoticeReadModelEntry[],
	): void {
		const selected = new Set(noticeIds);
		for (const [key, record] of [...this.records.entries()]) {
			if (
				record.source_corpus === sourceCorpus &&
				record.source_collection === sourceCollection &&
				selected.has(record.source_notice_id)
			) {
				this.records.delete(key);
			}
		}
		this.upsertMany(records);
	}

	listByScope(
		sourceCorpus: string,
		sourceCollection: string,
		input: { noticeIds?: string[] } = {},
	): InternalNoticeReadModelEntry[] {
		const selected = new Set(input.noticeIds ?? []);
		return [...this.records.values()]
			.filter(
				(record) =>
					record.source_corpus === sourceCorpus &&
					record.source_collection === sourceCollection &&
					(selected.size === 0 || selected.has(record.source_notice_id)),
			)
			.sort((left, right) =>
				`${left.source_notice_id}/${left.unit_id}`.localeCompare(
					`${right.source_notice_id}/${right.unit_id}`,
				),
			);
	}
}
