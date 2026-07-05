import type {
	ChatCampusServiceTraceCard,
	ChatMessageStructuredPart,
	ChatPlaceCard,
} from "../../chat";
import type { ToolExecutionResponse } from "../../integration";
import {
	dedupeStable,
	isRecord,
	normalizeOptionalString,
	normalizeStringArray,
	recordObjectArray,
	recordString,
	recordStringArray,
} from "./normalize-record-utils";
import { normalizeSourceItemsPart } from "./normalize-source-items";

export { normalizeSourceItemsPart } from "./normalize-source-items";

function normalizePointGeometry(value: unknown): ChatPlaceCard["pointGeometry"] {
	if (!isRecord(value)) {
		return null;
	}

	const longitude = typeof value.longitude === "number" ? value.longitude : null;
	const latitude = typeof value.latitude === "number" ? value.latitude : null;
	if (longitude === null || latitude === null) {
		return null;
	}

	return { latitude, longitude };
}

function normalizePlaceRef(
	value: unknown,
): Pick<
	ChatPlaceCard,
	"campusArea" | "campusScope" | "displayName" | "entityType" | "placeId"
> | null {
	if (!isRecord(value)) {
		return null;
	}

	const placeId = normalizeOptionalString(value.place_id);
	const entityType = normalizeOptionalString(value.entity_type);
	const displayName = normalizeOptionalString(value.display_name);
	if (!(placeId && entityType && displayName)) {
		return null;
	}

	return {
		placeId,
		entityType,
		displayName,
		campusScope: normalizeOptionalString(value.campus_scope),
		campusArea: normalizeOptionalString(value.campus_area),
	};
}

export function normalizePlaceCardPart(input: {
	selectedTool: string | null;
	status: ToolExecutionResponse["status"];
	result: unknown;
}): ChatMessageStructuredPart[] {
	if (input.selectedTool !== "place_lookup" || input.status !== "completed") {
		return [];
	}

	if (!isRecord(input.result)) {
		return [];
	}

	const placeCard = isRecord(input.result.place_card) ? input.result.place_card : null;
	if (!placeCard) {
		return [];
	}

	const place = normalizePlaceRef(placeCard.place);
	if (!place) {
		return [];
	}

	return [
		{
			type: "place_card",
			placeCard: {
				...place,
				locationDescription: normalizeOptionalString(
					placeCard.location_description ?? placeCard.address,
				),
				landmarkHint: normalizeOptionalString(placeCard.landmark_hint),
				accessNote: normalizeOptionalString(placeCard.access_note ?? placeCard.directions),
				openingNote: normalizeOptionalString(placeCard.opening_note ?? placeCard.hours),
				serviceTags: normalizeStringArray(placeCard.service_tags ?? placeCard.tags),
				pointGeometry: normalizePointGeometry(placeCard.point_geometry),
				coordinateReferenceSystem: normalizeOptionalString(placeCard.coordinate_reference_system),
				sourceRefs: normalizeStringArray(placeCard.source_refs),
			},
		},
	];
}

const UNSAFE_CAMPUS_SERVICE_TRACE_TOKEN_PATTERN =
	/(?:release[_-]?id|ingestion_projection|table_parser_state|debug[_-]?only|postgres|s3:\/\/)/iu;

const SAFE_CAMPUS_SERVICE_REF_PREFIX_PATTERNS = [
	/^authenticated_notice:\d+$/iu,
	/^official_web:[a-z0-9._:-]{2,200}$/iu,
	/^handbook:[a-z0-9._:-]{2,200}$/iu,
	/^service_catalog:[a-z0-9._:-]{2,200}$/iu,
	/^contact_directory:[a-z0-9._:-]{2,200}$/iu,
	/^notice:[a-z0-9._:-]{2,200}$/iu,
];

function normalizeCampusServiceTraceRef(ref: string): string | null {
	const normalized = ref.trim();
	if (!(normalized && normalized.length <= 220)) {
		return null;
	}
	if (UNSAFE_CAMPUS_SERVICE_TRACE_TOKEN_PATTERN.test(normalized)) {
		return null;
	}
	if (!SAFE_CAMPUS_SERVICE_REF_PREFIX_PATTERNS.some((pattern) => pattern.test(normalized))) {
		return null;
	}
	return normalized;
}

function formatCampusServiceTraceRef(ref: string): string {
	if (ref.startsWith("authenticated_notice:")) {
		return `认证通知 #${ref.split(":").at(-1)}`;
	}
	const internalNoticeMatch = ref.match(/^notice:[a-z0-9._-]{2,120}:(\d+)$/iu);
	if (internalNoticeMatch) {
		return `校内通知 #${internalNoticeMatch[1]}`;
	}
	if (ref.startsWith("official_web:")) {
		return `官网来源：${ref.split(":").slice(1).join("/")}`;
	}
	if (ref.startsWith("handbook:")) {
		return `手册来源：${ref.split(":").slice(1).join("/")}`;
	}
	if (ref.startsWith("service_catalog:")) {
		return `服务目录：${ref.split(":").slice(1).join("/")}`;
	}
	if (ref.startsWith("contact_directory:")) {
		return `联系人目录：${ref.split(":").slice(1).join("/")}`;
	}
	if (ref.startsWith("notice:")) {
		return `通知来源：${ref.split(":").slice(1).join("/")}`;
	}
	return ref;
}

function collectCampusServiceTraceRefsFromRecord(input: {
	record: Record<string, unknown>;
	noticeRefs: string[];
	sourceRefs: string[];
}) {
	input.noticeRefs.push(
		...recordStringArray(input.record, "related_notice_refs", "relatedNoticeRefs"),
	);
	input.noticeRefs.push(...recordStringArray(input.record, "notice_refs", "noticeRefs"));
	input.sourceRefs.push(...recordStringArray(input.record, "source_refs", "sourceRefs"));
	input.sourceRefs.push(
		...recordStringArray(input.record, "override_source_refs", "overrideSourceRefs"),
	);
	const rootSourceRef = recordString(input.record, "source_ref", "sourceRef");
	if (rootSourceRef) {
		input.sourceRefs.push(rootSourceRef);
	}

	for (const nestedRecord of [
		...recordObjectArray(input.record, "operational_notices", "operationalNotices"),
		...recordObjectArray(input.record, "contact_points", "contactPoints"),
		...recordObjectArray(input.record, "location_refs", "locationRefs"),
		...recordObjectArray(input.record, "office_hours", "officeHours"),
		...recordObjectArray(input.record, "guide_sections", "guideSections"),
		...recordObjectArray(input.record, "procedure_groups", "procedureGroups"),
		...recordObjectArray(input.record, "required_materials", "requiredMaterials"),
		...recordObjectArray(input.record, "entry_refs", "entryRefs"),
		...recordObjectArray(input.record, "contact_refs", "contactRefs"),
	]) {
		input.sourceRefs.push(...recordStringArray(nestedRecord, "source_refs", "sourceRefs"));
		const nestedSourceRef = recordString(nestedRecord, "source_ref", "sourceRef");
		if (nestedSourceRef) {
			input.sourceRefs.push(nestedSourceRef);
		}
		input.noticeRefs.push(
			...recordStringArray(nestedRecord, "related_notice_refs", "relatedNoticeRefs"),
		);
	}
}

function campusServiceResultRecords(result: unknown): Record<string, unknown>[] {
	if (!isRecord(result)) {
		return [];
	}
	const records: Record<string, unknown>[] = [result];
	const toolResult = isRecord(result.tool_result)
		? result.tool_result
		: isRecord(result.toolResult)
			? result.toolResult
			: null;
	if (toolResult && toolResult !== result) {
		records.push(toolResult);
	}
	return records;
}

function buildCampusServiceTraceCards(input: {
	noticeRefs: string[];
	sourceRefs: string[];
}): ChatCampusServiceTraceCard[] {
	const normalizedNoticeRefs = dedupeStable(
		input.noticeRefs
			.map((item) => normalizeCampusServiceTraceRef(item))
			.filter((item): item is string => item !== null),
	);
	const noticeRefSet = new Set(normalizedNoticeRefs);
	const normalizedSourceRefs = dedupeStable(
		input.sourceRefs
			.map((item) => normalizeCampusServiceTraceRef(item))
			.filter((item): item is string => item !== null)
			.filter((item) => !noticeRefSet.has(item)),
	);
	const noticeLabels = normalizedNoticeRefs.map(formatCampusServiceTraceRef).slice(0, 6);
	const sourceLabels = normalizedSourceRefs.map(formatCampusServiceTraceRef).slice(0, 8);
	const cards: ChatCampusServiceTraceCard[] = [];
	if (noticeLabels.length > 0) {
		cards.push({
			title: "相关通知",
			refs: noticeLabels,
		});
	}
	if (sourceLabels.length > 0) {
		cards.push({
			title: "信息来源",
			refs: sourceLabels,
		});
	}
	return cards;
}

export function normalizeCampusServiceTracePart(input: {
	selectedTool: string | null;
	status: ToolExecutionResponse["status"];
	result: unknown;
}): ChatMessageStructuredPart[] {
	if (input.selectedTool !== "transport_schedule_lookup" || input.status !== "completed") {
		return [];
	}

	const records = campusServiceResultRecords(input.result);
	if (records.length === 0) {
		return [];
	}

	const noticeRefs: string[] = [];
	const sourceRefs: string[] = [];
	for (const record of records) {
		collectCampusServiceTraceRefsFromRecord({
			record,
			noticeRefs,
			sourceRefs,
		});
	}
	const traceCards = buildCampusServiceTraceCards({
		noticeRefs,
		sourceRefs,
	});
	return traceCards.length > 0
		? [
				{
					type: "campus_service_trace_cards",
					traceCards,
				},
			]
		: [];
}

export function normalizeChatResponseStructuredParts(input: {
	allowedPublicNoticeHosts?: readonly string[];
	selectedTool: string | null;
	status: ToolExecutionResponse["status"];
	result: unknown;
}): ChatMessageStructuredPart[] {
	return [
		...normalizePlaceCardPart(input),
		...normalizeSourceItemsPart({
			...input,
			allowedPublicNoticeHosts: input.allowedPublicNoticeHosts,
		}),
		...normalizeCampusServiceTracePart(input),
	];
}
