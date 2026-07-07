import type { z } from "zod";

import {
	formatZodIssues,
	parseJsonObjectBytes,
	parseJsonObjectLinesBytes,
	parseOptionalText,
	sha256Hex,
} from "./core.ts";
import { FORBIDDEN_WECHAT_SOURCE_TRUTH_FIELDS } from "./wechat-public-notice-types.ts";

export function parseJsonObject(value: Uint8Array, label: string): Record<string, unknown> {
	return parseJsonObjectBytes(value, label);
}

export function parseJsonLines(value: Uint8Array, label: string): Record<string, unknown>[] {
	return parseJsonObjectLinesBytes(value, label);
}

export function parseWithSchema<T extends z.ZodType>(
	schema: T,
	value: unknown,
	label: string,
): z.infer<T> {
	const parsed = schema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`${label} is invalid: ${formatZodIssues(parsed.error.issues, label).join("; ")}`,
		);
	}
	return parsed.data;
}

export function ensureForbiddenFieldsAbsent(value: unknown): void {
	const found = findForbiddenFields(value);
	if (found.size > 0) {
		throw new Error(
			`wechat source truth contains forbidden fields: ${[...found].sort().join(", ")}`,
		);
	}
}

export async function loadOptionalJsonObject(input: {
	bucket: string;
	key: string;
	objectStore: { getObject(input: { bucket: string; key: string }): Promise<Uint8Array> };
}): Promise<Record<string, unknown> | null> {
	try {
		return parseJsonObject(
			await input.objectStore.getObject({ bucket: input.bucket, key: input.key }),
			"optional JSON object",
		);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("missing object:")) {
			return null;
		}
		throw error;
	}
}

export function normalizeRequiredRefValue(value: unknown, label: string): string {
	const normalized = text(value);
	if (!normalized) {
		throw new Error(`${label} is required`);
	}
	return normalized;
}

export function buildInlineImageArtifactKeys(input: { mediaRefId: string; mediaRefsKey: string }): {
	ocrManifestKey: string;
} {
	const articlePrefix = input.mediaRefsKey.replace(/\/source-truth\/media-refs\.jsonl$/u, "");
	return {
		ocrManifestKey: `${articlePrefix}/projection/wechat_public_notice/multimodal/${slugifySegment(input.mediaRefId)}/ocr-manifest.json`,
	};
}

export function compareProjectionEntries(
	left: { unit_id: string },
	right: { unit_id: string },
): number {
	return left.unit_id.localeCompare(right.unit_id);
}

export function compareReadModelEntries(
	left: { source_notice_id: string; unit_id: string },
	right: { source_notice_id: string; unit_id: string },
): number {
	return `${left.source_notice_id}/${left.unit_id}`.localeCompare(
		`${right.source_notice_id}/${right.unit_id}`,
	);
}

export function normalizeNoticeTimestamp(value: string): string {
	return value.trim();
}

export function toPublishDay(value: string): string {
	const normalized = value.trim();
	if (!normalized) {
		return "";
	}
	const parsed = Date.parse(normalized);
	if (Number.isFinite(parsed)) {
		return new Date(parsed).toISOString().slice(0, 10);
	}
	return normalized.slice(0, 10);
}

export function formatFrontMatterValue(value: string): string {
	if (!value) {
		return '""';
	}
	if (/[#[\]{},]/u.test(value) || value !== value.trim()) {
		return JSON.stringify(value);
	}
	return value;
}

export function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((item) => text(item)).filter(Boolean);
}

export function uniqueNonEmpty(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function text(value: unknown): string {
	return parseOptionalText(value) ?? "";
}

function findForbiddenFields(value: unknown): Set<string> {
	const found = new Set<string>();
	if (Array.isArray(value)) {
		for (const item of value) {
			for (const nested of findForbiddenFields(item)) {
				found.add(nested);
			}
		}
		return found;
	}
	if (typeof value !== "object" || value === null) {
		return found;
	}
	for (const [key, nested] of Object.entries(value)) {
		if (FORBIDDEN_WECHAT_SOURCE_TRUTH_FIELDS.has(key)) {
			found.add(key);
		}
		for (const nestedFound of findForbiddenFields(nested)) {
			found.add(nestedFound);
		}
	}
	return found;
}

function slugifySegment(value: string): string {
	const normalized = value
		.trim()
		.replace(/[^a-zA-Z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.toLowerCase();
	return normalized.slice(0, 96) || sha256Hex(value).slice(0, 16);
}
