const PROTECTED_SPAN_RE =
	/https?:\/\/[^\s<>'"，“，,。；;：:！）)]+|www\.[^\s<>'"，“，,。；;：:！）)]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b(?:doc_id|sha256|source_artifact_id|source_pdf|version_id|rawAssetId|rawVersionId):[A-Za-z0-9_./:-]+/g;
const ANY_SHORT_PAREN_RE = /\(([^()\n]{1,160})\)/g;
const ENUM_PAREN_RE = /\(([一二三四五六七八九十百千万〇零]{1,6}|\d{1,2})\)/g;
const INLINE_DECIMAL_ENUM_RE = /(^|[^\w.])(\d{1,2})\.(?=[\u3400-\u9fff])/g;
const INLINE_ALPHA_ENUM_RE = /(^|[^\w.])([A-Z])\.(?=[\u3400-\u9fff])/g;
const BIBLIOGRAPHY_MARKER_RE = /(\[[A-Za-z]{1,4}\])\.(?=[\u3400-\u9fff])/g;
const CJK_CONTEXT_SCAN_DISTANCE = 12;

const PUNCTUATION_MAP = new Map([
	[",", "，"],
	[":", "："],
	[";", "；"],
	["?", "？"],
	["!", "！"],
]);

export function normalizeReadableText(value: unknown): string {
	const text = String(value ?? "")
		.replace(/\r\n?/g, "\n")
		.normalize("NFC");
	if (!text) {
		return "";
	}
	const spans: string[] = [];
	const protectedText = text.replace(PROTECTED_SPAN_RE, (match) => {
		spans.push(match);
		return `\u{e000}${spans.length - 1}\u{e001}`;
	});
	const normalized = normalizeCjkContextPunctuation(
		normalizeReadableParentheses(protectedText.replace(ENUM_PAREN_RE, "（$1）")),
	)
		.replace(INLINE_DECIMAL_ENUM_RE, "$1$2. ")
		.replace(INLINE_ALPHA_ENUM_RE, "$1$2. ")
		.replace(BIBLIOGRAPHY_MARKER_RE, "$1. ")
		.replace(/([\u3400-\u9fff])\s+([，。；：？！])/g, "$1$2")
		.replace(/([，。；：？！])\s+([\u3400-\u9fff])/g, "$1$2");
	return spans.reduce(
		(current, span, index) => current.replaceAll(`\u{e000}${index}\u{e001}`, span),
		normalized,
	);
}

function normalizeReadableParentheses(text: string): string {
	let current = text;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		let changed = false;
		const source = current;
		current = source.replace(ANY_SHORT_PAREN_RE, (match, content: string, offset: number) => {
			if (shouldConvertParentheses(source, offset, offset + match.length, content)) {
				changed = true;
				return `（${content}）`;
			}
			return match;
		});
		if (!changed) {
			break;
		}
	}
	return current;
}

function shouldConvertParentheses(
	text: string,
	start: number,
	end: number,
	content: string,
): boolean {
	if (looksLikeMarkdownLinkDestination(text, start, content)) {
		return false;
	}
	if (/[\u3400-\u9fff]/.test(content)) {
		return true;
	}
	return hasNearbyCjk(text, start, end);
}

function looksLikeMarkdownLinkDestination(text: string, start: number, content: string): boolean {
	return text[start - 1] === "]" || /^(?:[./#]|https?:)/.test(content);
}

function normalizeCjkContextPunctuation(text: string): string {
	let output = "";
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index] ?? "";
		if (char === ".") {
			output += shouldConvertPeriod(text, index) ? "。" : char;
			continue;
		}
		const replacement = PUNCTUATION_MAP.get(char);
		output += replacement && hasCjkContext(text, index) ? replacement : char;
	}
	return output;
}

function shouldConvertPeriod(text: string, index: number): boolean {
	const previous = previousNonSpace(text, index);
	const following = nextNonSpace(text, index);
	if (looksLikeBibliographyMarkerPeriod(text, index)) {
		return false;
	}
	if (!previous || /\d/.test(previous)) {
		return false;
	}
	if (following && /\d/.test(following)) {
		return false;
	}
	return isCjk(previous) && (!following || isCjk(following));
}

function hasCjkContext(text: string, index: number): boolean {
	const previous = previousNonSpace(text, index);
	const following = nextNonSpace(text, index);
	return Boolean(
		(previous && isCjk(previous)) ||
			(following && isCjk(following)) ||
			hasNearbyCjk(text, index, index + 1),
	);
}

function hasNearbyCjk(text: string, start: number, end: number): boolean {
	const left = text.slice(Math.max(0, start - CJK_CONTEXT_SCAN_DISTANCE), start);
	const right = text.slice(end, Math.min(text.length, end + CJK_CONTEXT_SCAN_DISTANCE));
	return /[\u3400-\u9fff]/.test(left) || /[\u3400-\u9fff]/.test(right);
}

function looksLikeBibliographyMarkerPeriod(text: string, index: number): boolean {
	return /\[[A-Za-z]{1,4}\]$/.test(text.slice(Math.max(0, index - 6), index));
}

function previousNonSpace(text: string, index: number): string | undefined {
	for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
		const char = text[cursor];
		if (char && !/\s/.test(char)) {
			return char;
		}
	}
	return;
}

function nextNonSpace(text: string, index: number): string | undefined {
	for (let cursor = index + 1; cursor < text.length; cursor += 1) {
		const char = text[cursor];
		if (char && !/\s/.test(char)) {
			return char;
		}
	}
	return;
}

function isCjk(char: string): boolean {
	return /^[\u3400-\u9fff]$/.test(char);
}
