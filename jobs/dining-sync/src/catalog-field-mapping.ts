import type {
	DiningCatalogSourceRecords,
	FeishuCampusRecord,
	FeishuDishRecord,
	FeishuHallRecord,
	FeishuStallRecord,
} from "./catalog-source-types.ts";

export interface LarkTableRecord {
	fields: Record<string, unknown>;
	recordId: string;
}

export interface LarkCatalogTables {
	campuses: LarkTableRecord[];
	dishes: LarkTableRecord[];
	halls: LarkTableRecord[];
	stalls: LarkTableRecord[];
}

export function catalogRecordsFromLarkTables(input: LarkCatalogTables): DiningCatalogSourceRecords {
	return {
		campuses: input.campuses.map((record) => parseRecord(record, toCampusRecord, blockedCampus)),
		dishes: input.dishes.map((record) => parseRecord(record, toDishRecord, blockedDish)),
		halls: input.halls.map((record) => parseRecord(record, toHallRecord, blockedHall)),
		stalls: input.stalls.map((record) => parseRecord(record, toStallRecord, blockedStall)),
	};
}

function parseRecord<T>(
	record: LarkTableRecord,
	parse: (value: LarkTableRecord) => T,
	blocked: (value: LarkTableRecord) => T,
): T {
	try {
		return parse(record);
	} catch {
		return blocked(record);
	}
}

function blockedCampus(record: LarkTableRecord): FeishuCampusRecord {
	return {
		blockReason: "source_record_invalid",
		campusName: "",
		order: null,
		sourceRecordId: record.recordId,
	};
}

function blockedHall(record: LarkTableRecord): FeishuHallRecord {
	return {
		blockReason: "source_record_invalid",
		campusSourceRecordIds: [],
		hallName: "",
		order: null,
		sourceRecordId: record.recordId,
	};
}

function blockedStall(record: LarkTableRecord): FeishuStallRecord {
	return {
		blockReason: "source_record_invalid",
		hallSourceRecordIds: [],
		order: null,
		sourceRecordId: record.recordId,
		stallName: "",
		tags: [],
	};
}

function blockedDish(record: LarkTableRecord): FeishuDishRecord {
	return {
		blockReason: "source_record_invalid",
		dishName: "",
		priceLabel: null,
		sourceRecordId: record.recordId,
		stallSourceRecordIds: [],
		tags: [],
	};
}

function toCampusRecord(record: LarkTableRecord): FeishuCampusRecord {
	return {
		campusName: requireText(record.fields.校区名称, "校区名称"),
		order: optionalNumber(record.fields.排序),
		sourceRecordId: record.recordId,
	};
}

function toHallRecord(record: LarkTableRecord): FeishuHallRecord {
	return {
		campusSourceRecordIds: linkedRecordIds(record.fields.所属校区),
		hallName: requireText(record.fields.食堂名称, "食堂名称"),
		order: optionalNumber(record.fields.排序),
		sourceRecordId: record.recordId,
	};
}

function toStallRecord(record: LarkTableRecord): FeishuStallRecord {
	return {
		hallSourceRecordIds: linkedRecordIds(record.fields.所属食堂),
		order: optionalNumber(record.fields.排序),
		sourceRecordId: record.recordId,
		stallName: requireText(record.fields.档口名称, "档口名称"),
		tags: stringList(record.fields.品类),
	};
}

function toDishRecord(record: LarkTableRecord): FeishuDishRecord {
	return {
		dishName: requireText(record.fields.菜品名称, "菜品名称"),
		priceLabel: optionalText(record.fields.价格),
		sourceRecordId: record.recordId,
		stallSourceRecordIds: linkedRecordIds(record.fields.所属档口),
		tags: stringList(record.fields.标签),
	};
}

function requireText(value: unknown, fieldName: string): string {
	const text = optionalText(value);
	if (!text) {
		throw new Error(`Lark catalog field ${fieldName} must be non-empty text.`);
	}
	return text;
}

function optionalText(value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? trimmed : null;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	if (isRecord(value)) {
		const text = value.text ?? value.name;
		return typeof text === "string" && text.trim() ? text.trim() : null;
	}
	return null;
}

function optionalNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function stringList(value: unknown): string[] {
	if (value === null || value === undefined) {
		return [];
	}
	const values = Array.isArray(value) ? value : [value];
	return [
		...new Set(
			values
				.map(optionalText)
				.filter((item): item is string => item !== null)
				.map((item) => item.trim())
				.filter(Boolean),
		),
	];
}

function linkedRecordIds(value: unknown): string[] {
	if (value === null || value === undefined) {
		return [];
	}
	const values = Array.isArray(value) ? value : [value];
	return [
		...new Set(
			values
				.flatMap((item) => {
					if (typeof item === "string") {
						return [item.trim()];
					}
					if (isRecord(item)) {
						const recordId = item.record_id ?? item.recordId;
						if (typeof recordId === "string" && recordId.trim()) {
							return [recordId.trim()];
						}
						if (Array.isArray(item.record_ids)) {
							return item.record_ids
								.map((recordId) => (typeof recordId === "string" ? recordId.trim() : ""))
								.filter(Boolean);
						}
					}
					return [];
				})
				.filter(Boolean),
		),
	];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
