export interface SearchIndexHeader {
	id: string;
	text: string;
	charIndex?: number;
}

export interface SearchIndexPage {
	title: string;
	routePath: string;
	content: string;
	toc: SearchIndexHeader[];
}

interface HighlightInfo {
	start: number;
	length: number;
}

interface CommonSuggestion {
	title: string;
	header: string;
	link: string;
	query: string;
	highlightInfoList: HighlightInfo[];
}

export type StaticSearchSuggestion =
	| (CommonSuggestion & { type: "title" })
	| (CommonSuggestion & { type: "header" })
	| (CommonSuggestion & { type: "content"; statement: string });

const DEFAULT_LIMIT = 7;
const CONTENT_PREFIX_LENGTH = 32;
const CONTENT_SUFFIX_LENGTH = 68;

function normalizeSearchText(value: string): string {
	return value.trim().toLocaleLowerCase("zh-CN");
}

function getByteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}

function findCurrentHeader(page: SearchIndexPage, contentIndex: number): SearchIndexHeader | null {
	let current: SearchIndexHeader | null = null;
	for (const header of page.toc) {
		if (typeof header.charIndex !== "number") {
			continue;
		}
		if (header.charIndex > contentIndex) {
			break;
		}
		current = header;
	}
	return current;
}

function createContentStatement(
	content: string,
	contentIndex: number,
	queryLength: number,
): {
	statement: string;
	highlightStart: number;
} {
	const rawStart = Math.max(0, contentIndex - CONTENT_PREFIX_LENGTH);
	const rawEnd = Math.min(content.length, contentIndex + queryLength + CONTENT_SUFFIX_LENGTH);
	const hasPrefix = rawStart > 0;
	const hasSuffix = rawEnd < content.length;
	const statement = `${hasPrefix ? "..." : ""}${content.slice(rawStart, rawEnd)}${hasSuffix ? "..." : ""}`;

	return {
		statement,
		highlightStart: (hasPrefix ? 3 : 0) + contentIndex - rawStart,
	};
}

function pushIfRoom(
	results: StaticSearchSuggestion[],
	suggestion: StaticSearchSuggestion,
	limit: number,
): boolean {
	if (results.length >= limit) {
		return false;
	}
	results.push(suggestion);
	return results.length < limit;
}

export function buildStaticSearchSuggestions(
	rawQuery: string,
	pages: SearchIndexPage[],
	limit = DEFAULT_LIMIT,
): StaticSearchSuggestion[] {
	const query = normalizeSearchText(rawQuery);
	if (!query) {
		return [];
	}

	const results: StaticSearchSuggestion[] = [];
	const highlightLength = getByteLength(query);

	for (const page of pages) {
		const titleIndex = normalizeSearchText(page.title).indexOf(query);
		if (titleIndex < 0) {
			continue;
		}
		if (
			!pushIfRoom(
				results,
				{
					type: "title",
					title: page.title,
					header: page.title,
					link: page.routePath,
					query,
					highlightInfoList: [{ start: titleIndex, length: highlightLength }],
				},
				limit,
			)
		) {
			return results;
		}
	}

	for (const page of pages) {
		for (const header of page.toc) {
			const headerIndex = normalizeSearchText(header.text).indexOf(query);
			if (headerIndex < 0) {
				continue;
			}
			const headerPrefix = `${page.title} > `;
			if (
				!pushIfRoom(
					results,
					{
						type: "header",
						title: page.title,
						header: `${headerPrefix}${header.text}`,
						link: `${page.routePath}#${header.id}`,
						query,
						highlightInfoList: [
							{ start: headerPrefix.length + headerIndex, length: highlightLength },
						],
					},
					limit,
				)
			) {
				return results;
			}
		}
	}

	for (const page of pages) {
		const contentIndex = normalizeSearchText(page.content).indexOf(query);
		if (contentIndex < 0) {
			continue;
		}
		const currentHeader = findCurrentHeader(page, contentIndex);
		const { statement, highlightStart } = createContentStatement(
			page.content,
			contentIndex,
			rawQuery.length,
		);
		if (
			!pushIfRoom(
				results,
				{
					type: "content",
					title: page.title,
					header: currentHeader?.text ?? page.title,
					link: `${page.routePath}${currentHeader ? `#${currentHeader.id}` : ""}`,
					query,
					statement,
					highlightInfoList: [{ start: highlightStart, length: highlightLength }],
				},
				limit,
			)
		) {
			return results;
		}
	}

	return results;
}
