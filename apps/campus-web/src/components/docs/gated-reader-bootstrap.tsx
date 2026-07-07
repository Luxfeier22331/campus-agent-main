import { useEffect, useState } from "react";

import { buildAccountLoginUrlForCurrentRoute } from "@/platform/runtime/config";
import { DocsBootstrapStatus } from "./docs-bootstrap-status";

interface DocsResolveResponse {
	document: {
		collection: string;
		corpus: string;
		documentSlug: string;
		title: string;
	};
	readerAsset: {
		contentUrl: string;
		deliveryMode: "gated_asset" | "public_static_asset";
		outlineUrl: string;
	};
	readerState: {
		anchor: string | null;
		highlightRootUnitIds: string[];
	};
	resolvedVersion: {
		isCurrent?: boolean;
		label: string;
		versionSlug: string;
	};
}

interface ReaderPayload {
	document?: {
		title?: string;
	};
	sections?: Array<{
		anchor?: string;
		blocks?: Array<{
			headingLevel?: number;
			kind?: string;
			rootUnitId?: string;
			text?: string;
		}>;
		title?: string;
	}>;
}

interface ReaderRouteTarget {
	anchor: string | null;
	collection: string;
	corpus: string;
	documentSlug: string;
	highlightRootUnitIds: string[];
	version: string | null;
}

type ReaderState =
	| { status: "loading" }
	| { status: "not_found" }
	| { status: "unauthorized" }
	| { status: "unavailable" }
	| { reader: ReaderPayload; resolve: DocsResolveResponse; status: "ready" };

interface GatedReaderBootstrapProps {
	documentSlug?: string;
}

export default function GatedReaderBootstrap({ documentSlug }: GatedReaderBootstrapProps) {
	const [state, setState] = useState<ReaderState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;

		async function loadReader() {
			const target = parseReaderRoute(window.location, documentSlug);
			if (!target) {
				setState({ status: "not_found" });
				return;
			}

			try {
				const resolveResponse = await fetch(buildResolveUrl(target), {
					credentials: "include",
					headers: { accept: "application/json" },
				});
				if (!resolveResponse.ok) {
					setState(resolveFailureState(resolveResponse.status));
					return;
				}

				const resolved = (await resolveResponse.json()) as DocsResolveResponse;
				const readerAssetUrl = resolveReaderAssetContentUrl(resolved.readerAsset);
				if (!readerAssetUrl) {
					if (!cancelled) {
						setState({ status: "unavailable" });
					}
					return;
				}
				const readerResponse = await fetch(readerAssetUrl, {
					credentials: "include",
					headers: { accept: "application/json" },
				});
				if (!readerResponse.ok) {
					setState(resolveFailureState(readerResponse.status));
					return;
				}

				const reader = (await readerResponse.json()) as ReaderPayload;
				if (!cancelled) {
					setState({ reader, resolve: resolved, status: "ready" });
				}
			} catch {
				if (!cancelled) {
					setState({ status: "unavailable" });
				}
			}
		}

		void loadReader();
		return () => {
			cancelled = true;
		};
	}, [documentSlug]);

	if (state.status === "loading") {
		return <DocsBootstrapStatus kind="loading" title="正在读取文档" />;
	}
	if (state.status === "not_found") {
		return (
			<DocsBootstrapStatus
				description="请确认当前账号可以访问这份文档。"
				kind="not_found"
				title="无法打开文档"
			/>
		);
	}
	if (state.status === "unauthorized") {
		return (
			<DocsBootstrapStatus
				action={<a href={resolveLoginHref()}>登录后继续</a>}
				description="登录后会回到当前文档。"
				kind="unauthorized"
				title="请先登录"
			/>
		);
	}
	if (state.status === "unavailable") {
		return (
			<DocsBootstrapStatus
				action={
					<button type="button" onClick={() => window.location.reload()}>
						重新读取
					</button>
				}
				description="请稍后重试，或刷新当前页面。"
				kind="unavailable"
				title="文档暂不可用"
			/>
		);
	}

	const title = state.reader.document?.title || state.resolve.document.title;
	const collectionLabel = resolveCollectionLabel(state.resolve.document);
	const versionLabel = state.resolve.resolvedVersion.label || "当前版";
	const sourceLabel = collectionLabel;
	const versionsPayload = JSON.stringify({
		versions: [
			{
				isCurrent: state.resolve.resolvedVersion.isCurrent ?? true,
				label: versionLabel,
				versionSlug: state.resolve.resolvedVersion.versionSlug,
			},
		],
	});
	return (
		<article className="reader-bootstrap-article rspress-doc">
			<header
				className="document-meta-panel"
				data-docs-collection={state.resolve.document.collection}
				data-docs-corpus={state.resolve.document.corpus}
				data-docs-document-slug={state.resolve.document.documentSlug}
				data-docs-is-current={String(state.resolve.resolvedVersion.isCurrent ?? true)}
				data-docs-reader-meta="true"
				data-docs-route-slug={resolveCurrentRouteSlug()}
				data-docs-search-visibility={
					state.resolve.readerAsset.deliveryMode === "gated_asset"
						? "gated_bootstrap"
						: "public_current"
				}
				data-docs-version-slug={state.resolve.resolvedVersion.versionSlug}
				data-docs-versions={versionsPayload}
			>
				<p className="document-meta-summary">
					<span>{versionLabel}</span>
					<span>
						{state.resolve.readerAsset.deliveryMode === "gated_asset" ? "登录后可见" : "公开"}
					</span>
					<span>来源：{sourceLabel}</span>
				</p>
				<details className="document-meta-details">
					<summary>来源详情</summary>
					<dl>
						<div>
							<dt>文档集合</dt>
							<dd>{collectionLabel}</dd>
						</div>
						<div>
							<dt>版本</dt>
							<dd>{versionLabel}</dd>
						</div>
						<div>
							<dt>来源</dt>
							<dd>{sourceLabel}</dd>
						</div>
					</dl>
				</details>
			</header>
			<h1>{title}</h1>
			{withStableKeys(state.reader.sections ?? [], resolveSectionKey).map(
				({ item: section, key }) => (
					<section key={key}>
						{section.anchor ? <span id={section.anchor} /> : null}
						{section.title && section.title !== title ? <h2>{section.title}</h2> : null}
						{withStableKeys(section.blocks ?? [], resolveBlockKey).map(({ item: block, key }) =>
							renderReaderBlock(block, state.resolve.readerState, key),
						)}
					</section>
				),
			)}
		</article>
	);
}

function resolveFailureState(status: number): ReaderState {
	if (status === 401) {
		return { status: "unauthorized" };
	}
	if (status >= 500) {
		return { status: "unavailable" };
	}
	return { status: "not_found" };
}

function resolveLoginHref(): string {
	try {
		return buildAccountLoginUrlForCurrentRoute();
	} catch {
		return "/account/login";
	}
}

function resolveReaderAssetContentUrl(
	readerAsset: DocsResolveResponse["readerAsset"],
): string | null {
	if (readerAsset.deliveryMode !== "gated_asset") {
		return readerAsset.contentUrl;
	}
	try {
		const url = new URL(readerAsset.contentUrl, window.location.origin);
		if (url.origin !== window.location.origin || !url.pathname.startsWith("/_gated-docs/")) {
			return null;
		}
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return null;
	}
}

function parseReaderRoute(
	location: Location,
	documentSlugOverride?: string,
): ReaderRouteTarget | null {
	let parts: string[];
	try {
		parts = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
	} catch {
		return null;
	}
	if (parts[0] !== "docs" || parts.length < 4) {
		return null;
	}
	const version = parts[4] === "v" ? (parts[5] ?? null) : null;
	return {
		anchor: decodeLocationHash(location.hash),
		collection: parts[2],
		corpus: parts[1],
		documentSlug: documentSlugOverride?.trim() || parts[3],
		highlightRootUnitIds: parseHighlightRootUnitIds(new URLSearchParams(location.search).get("hl")),
		version,
	};
}

function decodeLocationHash(hash: string): string | null {
	if (!hash) {
		return null;
	}
	try {
		return decodeURIComponent(hash.slice(1));
	} catch {
		return null;
	}
}

function buildResolveUrl(input: ReaderRouteTarget): string {
	const params = new URLSearchParams();
	if (input.version) {
		params.set("version", input.version);
	}
	if (input.anchor) {
		params.set("anchor", input.anchor);
	}
	if (input.highlightRootUnitIds.length > 0) {
		params.set("hl", input.highlightRootUnitIds.join(","));
	}
	const query = params.toString();
	return `/api/docs/collections/${encodeURIComponent(input.corpus)}/${encodeURIComponent(
		input.collection,
	)}/documents/${encodeURIComponent(input.documentSlug)}/resolve${query ? `?${query}` : ""}`;
}

function parseHighlightRootUnitIds(value: string | null): string[] {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function resolveCurrentRouteSlug(): string {
	try {
		const parts = window.location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
		return parts[3] ?? "";
	} catch {
		return "";
	}
}

function resolveCollectionLabel(input: { collection: string; corpus: string }): string {
	if (input.corpus === "regulations" && input.collection === "student_rules") {
		return "学生手册";
	}
	if (input.corpus === "regulations" && input.collection === "institutional_rules") {
		return "校级制度";
	}
	if (input.corpus === "regulations" && input.collection === "scoped_rules") {
		return "专项规章";
	}
	if (input.corpus === "curriculum" && input.collection === "curriculum_plan") {
		return "培养方案";
	}
	return input.collection;
}

function resolveBlockClassName(
	rootUnitId: string | undefined,
	readerState: DocsResolveResponse["readerState"],
): string {
	const classNames = ["reader-block"];
	if (rootUnitId && readerState.highlightRootUnitIds.includes(rootUnitId)) {
		classNames.push("docs-reader-highlight");
	}
	return classNames.join(" ");
}

function renderReaderBlock(
	block: NonNullable<NonNullable<ReaderPayload["sections"]>[number]["blocks"]>[number],
	readerState: DocsResolveResponse["readerState"],
	key: string,
) {
	const text = normalizeReaderText(block.text);
	if (isReaderHeadingBlock(block, text)) {
		const HeadingTag = resolveHeadingTag(block.headingLevel, text);
		return <HeadingTag key={key}>{text}</HeadingTag>;
	}
	return (
		<div
			className={resolveBlockClassName(block.rootUnitId, readerState)}
			data-root-unit-id={block.rootUnitId}
			key={key}
		>
			{renderTextBlock(text)}
		</div>
	);
}

function renderTextBlock(text: string) {
	const table = parseSafeTable(text);
	if (table) {
		return (
			<div className="docs-table-scroll" data-docs-scrollable="true">
				<table>
					<tbody>
						{withStableKeys(table.rows, resolveSafeTableRowKey).map(({ item: row, key }) => (
							<tr key={key}>
								{withStableKeys(row, resolveSafeTableCellKey).map(({ item: cell, key }) => (
									<cell.tag colSpan={cell.colSpan} key={key} rowSpan={cell.rowSpan}>
										{cell.text}
									</cell.tag>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}
	return text.split(/\n{2,}/u).map((paragraph) => <p key={hashString(paragraph)}>{paragraph}</p>);
}

function isReaderHeadingBlock(
	block: NonNullable<NonNullable<ReaderPayload["sections"]>[number]["blocks"]>[number],
	text: string,
): boolean {
	return block.kind === "heading" && Boolean(text);
}

function resolveHeadingTag(level: number | undefined, text: string): "h2" | "h3" {
	const explicitLevel = typeof level === "number" ? Math.trunc(level) : undefined;
	if (explicitLevel === 2 || explicitLevel === 3) {
		return explicitLevel === 2 ? "h2" : "h3";
	}
	return /^(第[一二三四五六七八九十百]+章\b|[一二三四五六七八九十]+、\S)/u.test(text) ? "h2" : "h3";
}

function normalizeReaderText(value: string | undefined): string {
	return (value ?? "").trim();
}

interface SafeTable {
	rows: SafeTableCell[][];
}

interface SafeTableCell {
	colSpan?: number;
	rowSpan?: number;
	tag: "td" | "th";
	text: string;
}

function parseSafeTable(value: string): SafeTable | null {
	const text = value.trim();
	if (!/^<table(?:\s[^>]*)?>[\s\S]*<\/table>$/iu.test(text)) {
		return null;
	}
	if (text.replace(/<\/?[a-z][^>]*>/giu, "").includes("<")) {
		return null;
	}
	const document = new DOMParser().parseFromString(text, "text/html");
	const table = document.body.firstElementChild;
	if (
		document.body.children.length !== 1 ||
		!(table instanceof HTMLTableElement) ||
		!isSafeTableElementTree(table)
	) {
		return null;
	}

	const rows = Array.from(table.rows)
		.map((row) =>
			Array.from(row.cells).map((cell) => ({
				colSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
				rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
				tag: cell.tagName.toLowerCase() === "th" ? ("th" as const) : ("td" as const),
				text: cell.textContent ?? "",
			})),
		)
		.filter((row) => row.length > 0);
	return rows.length > 0 ? { rows } : null;
}

function isSafeTableElementTree(table: HTMLTableElement): boolean {
	const allowedTags = new Set(["table", "thead", "tbody", "tr", "th", "td"]);
	for (const element of Array.from(table.querySelectorAll("*"))) {
		const tagName = element.tagName.toLowerCase();
		if (!allowedTags.has(tagName) || (tagName === "table" && element !== table)) {
			return false;
		}
		const allowedAttributeNames =
			tagName === "td" || tagName === "th" ? ["colspan", "rowspan"] : [];
		for (const attributeName of element.getAttributeNames()) {
			const normalizedName = attributeName.toLowerCase();
			if (!allowedAttributeNames.includes(normalizedName)) {
				return false;
			}
			const value = element.getAttribute(attributeName) ?? "";
			if (!/^[1-9][0-9]{0,2}$/u.test(value)) {
				return false;
			}
		}
	}
	return table.getAttributeNames().length === 0;
}

function resolveSafeTableRowKey(row: SafeTableCell[]): string {
	return row.map(resolveSafeTableCellKey).join("|");
}

function resolveSafeTableCellKey(cell: SafeTableCell): string {
	return `${cell.tag}:${cell.rowSpan ?? 1}:${cell.colSpan ?? 1}:${cell.text}`;
}

function resolveSectionKey(section: NonNullable<ReaderPayload["sections"]>[number]): string {
	return section.anchor || section.title || hashString(JSON.stringify(section));
}

function resolveBlockKey(
	block: NonNullable<NonNullable<ReaderPayload["sections"]>[number]["blocks"]>[number],
): string {
	return block.rootUnitId || hashString(`${block.kind ?? "block"}:${block.text ?? ""}`);
}

function withStableKeys<T>(
	items: readonly T[],
	resolveBaseKey: (item: T) => string,
): Array<{ item: T; key: string }> {
	const seen = new Map<string, number>();
	return items.map((item) => {
		const baseKey = resolveBaseKey(item) || "item";
		const count = seen.get(baseKey) ?? 0;
		seen.set(baseKey, count + 1);
		return { item, key: count === 0 ? baseKey : `${baseKey}-${count}` };
	});
}

function hashString(value: string): string {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 31 + value.charCodeAt(index)) | 0;
	}
	return `h${Math.abs(hash).toString(36)}`;
}
