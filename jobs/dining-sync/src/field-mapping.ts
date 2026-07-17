import type { DiningSourceRecord, LarkAttachmentRef } from "./types";

export const DINING_LARK_FIELD_IDS = {
	attachments: "fldyqctdoB",
	campus: "fldGE8Z5vG",
	comment: "fldIBfi1eC",
	contributorName: "fldHJzHJpX",
	dishName: "flduqrX7Ab",
	hallName: "fldmJk9inX",
	paidPrice: "fldomqSoKM",
	rating: "fldOWOVRMX",
	stallName: "fldPRZItgB",
} as const;

export type DiningLarkFieldId = (typeof DINING_LARK_FIELD_IDS)[keyof typeof DINING_LARK_FIELD_IDS];

export function recordFromFieldMap(input: {
	fields: Map<string, unknown>;
	sourceRecordId: string;
	submittedAt: string | null;
}): DiningSourceRecord {
	return {
		attachments: parseAttachments(input.fields.get(DINING_LARK_FIELD_IDS.attachments)),
		campus: requireSelect(
			input.fields.get(DINING_LARK_FIELD_IDS.campus),
			DINING_LARK_FIELD_IDS.campus,
		),
		comment: optionalText(input.fields.get(DINING_LARK_FIELD_IDS.comment)),
		contributorName: optionalText(input.fields.get(DINING_LARK_FIELD_IDS.contributorName)),
		dishName: requireText(
			input.fields.get(DINING_LARK_FIELD_IDS.dishName),
			DINING_LARK_FIELD_IDS.dishName,
		),
		hallName: requireSelect(
			input.fields.get(DINING_LARK_FIELD_IDS.hallName),
			DINING_LARK_FIELD_IDS.hallName,
		),
		paidPriceLabel: parsePriceLabel(input.fields.get(DINING_LARK_FIELD_IDS.paidPrice)),
		rating: optionalNumber(input.fields.get(DINING_LARK_FIELD_IDS.rating)),
		sourceRecordId: input.sourceRecordId,
		stallName: requireText(
			input.fields.get(DINING_LARK_FIELD_IDS.stallName),
			DINING_LARK_FIELD_IDS.stallName,
		),
		submittedAt: input.submittedAt,
	};
}

function requireSelect(value: unknown, fieldId: string): string {
	if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") {
		return requireText(value[0], fieldId);
	}
	if (typeof value === "string") {
		return requireText(value, fieldId);
	}
	if (isRecord(value) && typeof value.text === "string") {
		return requireText(value.text, fieldId);
	}
	if (isRecord(value) && typeof value.name === "string") {
		return requireText(value.name, fieldId);
	}
	throw new Error(`Lark field ${fieldId} must be a single select value.`);
}

function requireText(value: unknown, fieldId: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Lark field ${fieldId} must be non-empty text.`);
	}
	return value.trim();
}

function optionalText(value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== "string") {
		throw new Error("Optional Lark text field must be text when present.");
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function optionalNumber(value: unknown): number | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error("Optional Lark number field must be numeric when present.");
	}
	return value;
}

function parsePriceLabel(value: unknown): string | null {
	const price = optionalNumber(value);
	return price === null ? null : `${price} 元`;
}

function parseAttachments(value: unknown): LarkAttachmentRef[] {
	if (value === null || value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new Error("Lark attachment field must be an array when present.");
	}
	return value.map((item) => {
		if (!isRecord(item)) {
			throw new Error("Lark attachment item must be an object.");
		}
		const fileToken = item.file_token;
		const name = item.name;
		const size = item.size;
		if (typeof fileToken !== "string" || !fileToken.trim()) {
			throw new Error("Lark attachment item is missing file_token.");
		}
		if (typeof name !== "string" || !name.trim()) {
			throw new Error("Lark attachment item is missing name.");
		}
		if (typeof size !== "number" || !Number.isFinite(size)) {
			throw new Error("Lark attachment item is missing numeric size.");
		}
		return { fileToken: fileToken.trim(), name: name.trim(), size };
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
