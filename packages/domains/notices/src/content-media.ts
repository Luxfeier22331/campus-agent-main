import {
	GENERIC_IMAGE_NAME,
	IMAGE_EXTENSION,
	NON_DESCRIPTIVE_IMAGE_NAME,
} from "./content-constants.ts";
import { normalizeInlineWhitespace } from "./content-text.ts";

export function safeLink(value: string | null): string | null {
	const normalized = value?.trim();
	if (!normalized) {
		return null;
	}
	try {
		const parsed = new URL(normalized);
		return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? normalized : null;
	} catch {
		return null;
	}
}

export function normalizePortalImageUrl(value: string | null, portalHost: string): string | null {
	if (!value) {
		return null;
	}
	try {
		const parsed = new URL(value, `https://${portalHost}`);
		if (
			parsed.hostname.toLowerCase() !== portalHost ||
			!["http:", "https:"].includes(parsed.protocol)
		) {
			return null;
		}
		parsed.protocol = "https:";
		parsed.username = "";
		parsed.password = "";
		return parsed.toString();
	} catch {
		return null;
	}
}

export function isEditorPlaceholderImage(
	normalizedUrl: string,
	widthValue: string | null,
	heightValue: string | null,
): boolean {
	if (new URL(normalizedUrl).pathname.toLowerCase().endsWith("/spacer.gif")) {
		return true;
	}
	const width = parsePositiveDimension(widthValue);
	const height = parsePositiveDimension(heightValue);
	return width !== null && height !== null && width <= 1 && height <= 1;
}

function parsePositiveDimension(value: string | null): number | null {
	if (!(value && /^\d+(?:\.\d+)?$/u.test(value.trim()))) {
		return null;
	}
	const dimension = Number(value);
	return dimension > 0 ? dimension : null;
}

export function normalizeImageAlt(value: string | null): string {
	const normalized = normalizeInlineWhitespace(value ?? "").trim();
	if (!normalized) {
		return "";
	}
	const stem = normalized.replace(IMAGE_EXTENSION, "");
	if (GENERIC_IMAGE_NAME.test(stem) || NON_DESCRIPTIVE_IMAGE_NAME.test(stem)) {
		return "";
	}
	return normalized.slice(0, 500);
}
