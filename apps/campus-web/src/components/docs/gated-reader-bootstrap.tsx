import { useEffect, useState } from "react";

import { buildAccountLoginUrlForCurrentRoute } from "@/platform/runtime/config";
import { DocsBootstrapStatus } from "./docs-bootstrap-status";
import {
	ReaderAnchor,
	ReaderBlock,
	ReaderDocument,
	ReaderDocumentMeta,
	ReaderHeading,
	ReaderTable,
	type ReaderTableCell,
} from "./reader-components";

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
	renderTitle?: boolean;
}

export default function GatedReaderBootstrap({
	documentSlug,
	renderTitle = true,
}: GatedReaderBootstrapProps) {
	const [state, setState] = useState<ReaderState>({ status: "loading" });

	useEffect(() => {
		const controller = new AbortController();

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
					signal: controller.signal,
				});
				if (!resolveResponse.ok) {
					setState(resolveFailureState(resolveResponse.status));
					return;
				}

				const resolved = (await resolveResponse.json()) as DocsResolveResponse;
				const readerAssetUrl = resolveReaderAssetContentUrl(resolved.readerAsset);
				if (!readerAssetUrl) {
					if (!controller.signal.aborted) {
						setState({ status: "unavailable" });
					}
					return;
				}
				const readerResponse = await fetch(readerAssetUrl, {
					credentials: "include",
					headers: { accept: "application/json" },
					signal: controller.signal,
				});
				if (!readerResponse.ok) {
					setState(resolveFailureState(readerResponse.status));
					return;
				}

				const reader = (await readerResponse.json()) as ReaderPayload;
				if (!controller.signal.aborted) {
					setState({ reader, resolve: resolved, status: "ready" });
				}
			} catch {
				if (!controller.signal.aborted) {
					setState({ status: "unavailable" });
				}
			}
		}

		void loadReader();
		return () => {
			controller.abort();
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
	return (
		<ReaderDocument
			as="article"
			className="reader-bootstrap-article rspress-doc"
			layout="reference"
			measure="wide"
		>
			<ReaderDocumentMeta
				accessLabel={
					state.resolve.readerAsset.deliveryMode === "gated_asset" ? "登录后可见" : "公开"
				}
				collection={state.resolve.document.collection}
				collectionLabel={collectionLabel}
				corpus={state.resolve.document.corpus}
				documentSlug={state.resolve.document.documentSlug}
				isCurrent={state.resolve.resolvedVersion.isCurrent ?? true}
				routeSlug={resolveCurrentRouteSlug()}
				searchVisibility={
					state.resolve.readerAsset.deliveryMode === "gated_asset"
						? "gated_bootstrap"
						: "public_current"
				}
				sourceLabel={sourceLabel}
				versionLabel={versionLabel}
				versionSlug={state.resolve.resolvedVersion.versionSlug}
				versions={[
					{
						isCurrent: state.resolve.resolvedVersion.isCurrent ?? true,
						label: versionLabel,
						versionSlug: state.resolve.resolvedVersion.versionSlug,
					},
				]}
			/>
			{renderTitle ? <h1>{title}</h1> : null}
			{withStableKeys(state.reader.sections ?? [], resolveSectionKey).map(
				({ item: section, key }) => {
					const sectionRootUnitId = section.blocks?.find((block) => block.rootUnitId)?.rootUnitId;
					const sectionAnchor = section.anchor || key;
					return (
						<section key={key}>
							{section.title && section.title !== title ? (
								<ReaderHeading
									anchor={sectionAnchor}
									level={2}
									rootUnitId={sectionRootUnitId}
									title={section.title}
								/>
							) : section.anchor ? (
								<ReaderAnchor id={section.anchor} />
							) : null}
							{withStableKeys(section.blocks ?? [], resolveBlockKey).map(({ item: block, key }) =>
								renderReaderBlock(block, key),
							)}
						</section>
					);
				},
			)}
		</ReaderDocument>
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

function renderReaderBlock(
	block: NonNullable<NonNullable<ReaderPayload["sections"]>[number]["blocks"]>[number],
	key: string,
) {
	const text = normalizeReaderText(block.text);
	if (isReaderHeadingBlock(block, text)) {
		return (
			<ReaderHeading
				anchor={block.rootUnitId || key}
				key={key}
				level={resolveHeadingLevel(block.headingLevel, text)}
				rootUnitId={block.rootUnitId}
				title={text}
			/>
		);
	}
	return (
		<ReaderBlock key={key} rootUnitId={block.rootUnitId}>
			{renderTextBlock(text)}
		</ReaderBlock>
	);
}

function renderTextBlock(text: string) {
	const table = parseSafeTable(text);
	if (table) {
		return <ReaderTable rows={table.rows} />;
	}
	return text.split(/\n{2,}/u).map((paragraph) => <p key={hashString(paragraph)}>{paragraph}</p>);
}

function isReaderHeadingBlock(
	block: NonNullable<NonNullable<ReaderPayload["sections"]>[number]["blocks"]>[number],
	text: string,
): boolean {
	return block.kind === "heading" && Boolean(text);
}

function resolveHeadingLevel(level: number | undefined, text: string): 2 | 3 {
	const explicitLevel = typeof level === "number" ? Math.trunc(level) : undefined;
	if (explicitLevel === 2 || explicitLevel === 3) {
		return explicitLevel;
	}
	return /^(第[一二三四五六七八九十百]+章\b|[一二三四五六七八九十]+、\S)/u.test(text) ? 2 : 3;
}

function normalizeReaderText(value: string | undefined): string {
	return (value ?? "").trim();
}

interface SafeTable {
	rows: SafeTableCell[][];
}

type SafeTableCell = ReaderTableCell;

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
