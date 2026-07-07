import { describe, expect, it } from "vitest";
import {
	applyNoticeConsumptionProjectionRebuild,
	type NoticeConsumptionProjectionEntry,
	parseNoticeConsumptionProjectionEntry,
	selectReadyNoticeConsumptionTargetDocumentIds,
	stampNoticeConsumptionAdmissionProvenance,
} from "../src/index.ts";

const READY_FOR_TARGET = "ready_for_target_materialization";

describe("notice consumption projection lifecycle", () => {
	it("applies selected notice rebuild without replacing unrelated rows", () => {
		const store = new InMemoryNoticeConsumptionProjectionStore([
			projectionEntry("355222", "stale-unit"),
			projectionEntry("999999", "unrelated-unit"),
		]);

		const rows = applyNoticeConsumptionProjectionRebuild({
			entries: [
				projectionEntry("355222", "notice_unit:355222:notice_window"),
				projectionEntry("888888", "notice_unit:888888:notice_window"),
			],
			noticeIds: ["355222"],
			projectionStore: store,
			sourceCollection: "internal_notice",
			sourceCorpus: "campus_notices",
		});

		expect(rows.map((row) => row.unit_id)).toEqual(["notice_unit:355222:notice_window"]);
		expect(
			store.listByScope("campus_notices", "internal_notice").map((row) => row.unit_id),
		).toEqual(["notice_unit:355222:notice_window", "unrelated-unit"]);
	});

	it("fails closed for persistent full-scope rebuilds", () => {
		expect(() =>
			applyNoticeConsumptionProjectionRebuild({
				entries: [projectionEntry("355222", "notice_unit:355222:notice_window")],
				projectionStore: new InMemoryNoticeConsumptionProjectionStore(),
				sourceCollection: "internal_notice",
				sourceCorpus: "campus_notices",
			}),
		).toThrow("refusing persistent full-scope notice consumption projection rebuild");
	});

	it("stamps consumer admission provenance onto role metadata", () => {
		const [row] = stampNoticeConsumptionAdmissionProvenance(
			[projectionEntry("355222", "notice_unit:355222:notice_window")],
			{
				admissionBatchId: "batch-projection-001",
				admissionCommand: "projection_rebuild",
				admissionCreatedAt: "2026-04-25T00:00:00Z",
			},
		);

		expect(row?.role_metadata).toMatchObject({
			consumer_admission_batch_id: "batch-projection-001",
			consumer_admission_command: "projection_rebuild",
			consumer_admission_created_at: "2026-04-25T00:00:00Z",
		});
	});

	it("selects ready target document ids by target surface and primary role", () => {
		const rows = [
			projectionEntry("187233", "notice_unit:187233:rule", {
				consumptionStatus: READY_FOR_TARGET,
				primaryRole: "attachment_rule_body",
				sourceDocumentId: "notice:example_internal_portal:187233",
				targetSurface: "regulations/institutional_rules",
			}),
			projectionEntry("351907", "notice_unit:351907:rule", {
				consumptionStatus: READY_FOR_TARGET,
				primaryRole: "annual_cycle_rule",
				sourceDocumentId: "notice:example_internal_portal:351907",
				targetSurface: "regulations/scoped_rules",
			}),
			projectionEntry("355222", "notice_unit:355222:notice_window"),
		];

		expect(
			selectReadyNoticeConsumptionTargetDocumentIds(rows, {
				primaryRoles: ["attachment_rule_body"],
				targetSurface: "regulations/institutional_rules",
			}),
		).toEqual(["notice:example_internal_portal:187233"]);
		expect(
			selectReadyNoticeConsumptionTargetDocumentIds(rows, {
				targetSurface: "regulations/scoped_rules",
			}),
		).toEqual(["notice:example_internal_portal:351907"]);
	});

	it("parses projection rows with zod and normalizes array defaults", () => {
		const parsed = parseNoticeConsumptionProjectionEntry({
			...projectionEntry("355222", "notice_unit:355222:notice_window"),
			role_metadata: { notice_title: "测试通知" },
			source_attachment_ref_ids: undefined,
		});

		expect(parsed.role_metadata).toEqual({ notice_title: "测试通知" });
		expect(parsed.source_attachment_ref_ids).toEqual([]);
	});

	it("rejects retired manual review status values", () => {
		expect(() =>
			parseNoticeConsumptionProjectionEntry({
				...projectionEntry("355222", "notice_unit:355222:notice_window"),
				consumption_status: "manual_review_required",
			}),
		).toThrow("unsupported notice consumption status: manual_review_required");
		expect(() =>
			parseNoticeConsumptionProjectionEntry({
				...projectionEntry("355222", "notice_unit:355222:notice_window"),
				consumption_status: "review_later",
			}),
		).toThrow("unsupported notice consumption status: review_later");
	});
});

function projectionEntry(
	noticeId: string,
	unitId: string,
	input: {
		consumptionStatus?: string;
		primaryRole?: string;
		sourceDocumentId?: string | null;
		targetSurface?: string;
	} = {},
): NoticeConsumptionProjectionEntry {
	const sourceDocumentId =
		input.sourceDocumentId === undefined
			? `notice:example_internal_portal:${noticeId}`
			: input.sourceDocumentId;
	return {
		answerability: "answerable",
		completeness_status: "complete",
		consumption_status: input.consumptionStatus ?? "retained_for_notice_query",
		default_agent: "notice",
		primary_role: input.primaryRole ?? "notice_window",
		role_metadata: {},
		semantic_owner: "notice_body",
		source_attachment_ref_ids: [],
		source_collection: "internal_notice",
		source_corpus: "campus_notices",
		source_document_id: sourceDocumentId,
		source_family: "internal_notice_restricted",
		source_notice_document_id: `notice:example_internal_portal:${noticeId}`,
		source_notice_id: noticeId,
		source_notice_release_time: "2026-04-10",
		target_surface: input.targetSurface ?? "notice_level_query",
		temporal_policy: "announcement_window",
		unit_id: unitId,
		updated_at: "2026-04-10T00:00:00+00:00",
	};
}

class InMemoryNoticeConsumptionProjectionStore {
	readonly records = new Map<string, NoticeConsumptionProjectionEntry>();

	constructor(records: NoticeConsumptionProjectionEntry[] = []) {
		this.upsertMany(records);
	}

	upsertMany(records: NoticeConsumptionProjectionEntry[]): void {
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
		records: NoticeConsumptionProjectionEntry[],
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
	): NoticeConsumptionProjectionEntry[] {
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
