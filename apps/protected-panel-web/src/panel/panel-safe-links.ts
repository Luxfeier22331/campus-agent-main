const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

export function normalizeSafeExternalHref(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const parsed = new URL(trimmed);
		return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null;
	} catch {
		return null;
	}
}

export function formatExternalHrefLabel(value: string | null | undefined): string {
	return normalizeSafeExternalHref(value) ?? "不可用";
}
