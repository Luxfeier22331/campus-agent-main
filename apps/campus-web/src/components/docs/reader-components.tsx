import {
	Button,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@campus-agent/ui";
import { History, Link as LinkIcon } from "lucide-react";
import {
	type ComponentProps,
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import {
	buildVersionReaderHref,
	parseReaderLocationState,
	type ReaderLocationState,
} from "@/features/docs/reader-state";

const COPY_LINK_RESET_MS = 3000;
const EMPTY_READER_STATE: ReaderLocationState = {
	anchor: null,
	highlightRootUnitIds: [],
};

interface ReaderContextValue {
	locationState: ReaderLocationState;
	permalinkRootUnitIds: Readonly<Record<string, string>>;
}

const ReaderContext = createContext<ReaderContextValue>({
	locationState: EMPTY_READER_STATE,
	permalinkRootUnitIds: {},
});

export interface ReaderTableCell {
	colSpan?: number;
	rowSpan?: number;
	tag: "td" | "th";
	text: string;
}

export interface ReaderVersion {
	isCurrent: boolean;
	label: string;
	versionSlug: string;
}

export function ReaderDocument({
	as = "div",
	children,
	className,
	locationHref,
	permalinkRootUnitIds = {},
}: {
	as?: "article" | "div";
	children: ReactNode;
	className?: string;
	locationHref?: string;
	permalinkRootUnitIds?: Readonly<Record<string, string>>;
}) {
	const [locationState, setLocationState] = useState<ReaderLocationState>(EMPTY_READER_STATE);

	useEffect(() => {
		const updateLocationState = () => setLocationState(readBrowserLocationState());
		updateLocationState();
		window.addEventListener("hashchange", updateLocationState);
		window.addEventListener("popstate", updateLocationState);
		return () => {
			window.removeEventListener("hashchange", updateLocationState);
			window.removeEventListener("popstate", updateLocationState);
		};
	}, []);

	useEffect(() => {
		if (locationHref) {
			setLocationState(parseReaderLocationState(locationHref));
		}
	}, [locationHref]);

	useEffect(() => {
		if (!locationState.anchor) {
			return;
		}
		const target = document.getElementById(locationState.anchor);
		if (!target) {
			return;
		}
		if (!target.hasAttribute("tabindex")) {
			target.tabIndex = -1;
		}
		target.scrollIntoView?.({ block: "start" });
		target.focus({ preventScroll: true });
	}, [locationState.anchor]);

	const context = useMemo<ReaderContextValue>(
		() => ({ locationState, permalinkRootUnitIds }),
		[locationState, permalinkRootUnitIds],
	);
	const Element = as;
	return (
		<ReaderContext.Provider value={context}>
			<Element className={["docs-reader-document", className].filter(Boolean).join(" ")}>
				{children}
			</Element>
		</ReaderContext.Provider>
	);
}

export function ReaderAnchor({ id }: { id: string }) {
	return <span className="docs-reader-anchor" id={id} tabIndex={-1} />;
}

export function ReaderBlock({
	children,
	rootUnitId,
}: {
	children: ReactNode;
	rootUnitId?: string;
}) {
	const { locationState } = useContext(ReaderContext);
	const highlighted = Boolean(
		rootUnitId && locationState.highlightRootUnitIds.includes(rootUnitId),
	);
	return (
		<div
			className={highlighted ? "reader-block docs-reader-highlight" : "reader-block"}
			data-root-unit-id={rootUnitId}
		>
			{children}
		</div>
	);
}

export function ReaderHeading({
	anchor,
	children,
	level,
	rootUnitId,
	title,
}: {
	anchor: string;
	children?: ReactNode;
	level: 1 | 2 | 3 | 4 | 5 | 6;
	rootUnitId?: string;
	title: string;
}) {
	const Heading = `h${level}` as keyof Pick<
		React.JSX.IntrinsicElements,
		"h1" | "h2" | "h3" | "h4" | "h5" | "h6"
	>;
	const { locationState } = useContext(ReaderContext);
	const highlighted = Boolean(
		rootUnitId && locationState.highlightRootUnitIds.includes(rootUnitId),
	);
	return (
		<div className="docs-reader-heading-row">
			<Heading
				aria-label={title}
				className={highlighted ? "docs-toc-heading docs-reader-highlight" : "docs-toc-heading"}
				id={anchor}
			>
				{children ?? title}
			</Heading>
			<ReaderPermalink anchor={anchor} rootUnitId={rootUnitId} title={title} />
		</div>
	);
}

export function ReaderPermalink({
	anchor,
	rootUnitId,
	title,
}: {
	anchor: string;
	rootUnitId?: string | null;
	title: string;
}) {
	const [status, setStatus] = useState("");
	const resetTimer = useRef<number | null>(null);
	const { permalinkRootUnitIds } = useContext(ReaderContext);
	const relatedRootUnitId = rootUnitId ?? permalinkRootUnitIds[anchor] ?? null;

	useEffect(
		() => () => {
			if (resetTimer.current !== null) {
				window.clearTimeout(resetTimer.current);
			}
		},
		[],
	);

	async function copyPermalink() {
		try {
			if (!navigator.clipboard) {
				throw new Error("clipboard unavailable");
			}
			await navigator.clipboard.writeText(
				buildReaderPermalink({ anchor, rootUnitId: relatedRootUnitId }),
			);
			showStatus("已复制链接");
		} catch {
			showStatus("无法复制链接");
		}
	}

	function showStatus(message: string) {
		setStatus(message);
		if (resetTimer.current !== null) {
			window.clearTimeout(resetTimer.current);
		}
		resetTimer.current = window.setTimeout(() => setStatus(""), COPY_LINK_RESET_MS);
	}

	return (
		<span className="docs-reader-heading-actions" data-docs-copy-link-for={anchor}>
			<TooltipProvider delayDuration={300}>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							aria-label={`复制“${title}”链接`}
							className="text-[var(--sys-text-subtle)] hover:text-[var(--docs-accent)]"
							onClick={() => void copyPermalink()}
							size="icon-lg"
							type="button"
							variant="ghost"
						>
							<LinkIcon aria-hidden="true" className="size-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">复制链接</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<span
				aria-live="polite"
				className="docs-reader-copy-link-status"
				role={status ? "status" : undefined}
			>
				{status}
			</span>
		</span>
	);
}

export function ReaderDocumentMeta({
	collection,
	collectionLabel,
	corpus,
	documentSlug,
	isCurrent,
	onVersionNavigate,
	routeSlug,
	sourceLabel,
	topicLabel,
	versionLabel,
	versionSlug,
	versions,
}: {
	collection: string;
	collectionLabel: string;
	corpus: string;
	documentSlug: string;
	isCurrent: boolean;
	onVersionNavigate?: (href: string) => void;
	routeSlug: string;
	sourceLabel: string;
	topicLabel: string | null;
	versionLabel: string;
	versionSlug: string;
	versions?: ReaderVersion[];
}) {
	const resolvedVersions = versions ?? [];
	const hasMultipleVersions = resolvedVersions.length > 1;

	function selectVersion(nextVersionSlug: string) {
		const version = resolvedVersions.find((item) => item.versionSlug === nextVersionSlug);
		if (!version) {
			return;
		}
		const href = buildVersionReaderHref({
			collection,
			corpus,
			documentSlug,
			isCurrent: version.isCurrent,
			routeSlug,
			versionSlug: version.versionSlug,
		});
		if (onVersionNavigate) {
			onVersionNavigate(href);
			return;
		}
		window.location.assign(href);
	}

	return (
		<section
			aria-label="文档来源与版本"
			className="document-meta-panel"
			data-docs-collection={collection}
			data-docs-corpus={corpus}
			data-docs-document-slug={documentSlug}
			data-docs-is-current={String(isCurrent)}
			data-docs-reader-meta="true"
			data-docs-route-slug={routeSlug}
			data-docs-multiple-versions={String(hasMultipleVersions)}
			data-docs-version-slug={versionSlug}
			data-docs-versions={JSON.stringify({ versions: resolvedVersions })}
		>
			<p className="document-meta-summary">
				{hasMultipleVersions ? null : <span>{versionLabel}</span>}
				{topicLabel ? <span>主题：{topicLabel}</span> : null}
				<span>来源：{sourceLabel}</span>
			</p>
			<div className="document-meta-controls">
				{isCurrent ? null : (
					<p
						aria-label="正在阅读历史版本，请以当前版为准。"
						className="docs-reader-status docs-version-history-warning"
						role="status"
						title="正在阅读历史版本，请以当前版为准。"
					>
						历史版本
					</p>
				)}
				{hasMultipleVersions ? (
					<div className="docs-version-switcher">
						<Select name="docs-version" onValueChange={selectVersion} value={versionSlug}>
							<SelectTrigger aria-label="选择文档版本" className="docs-version-trigger">
								<History aria-hidden="true" />
								<SelectValue />
							</SelectTrigger>
							<SelectContent className="docs-version-menu">
								{resolvedVersions.map((version) => (
									<SelectItem
										className="docs-version-option"
										key={version.versionSlug}
										value={version.versionSlug}
									>
										{version.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				) : null}
				<details className="document-meta-details">
					<summary>来源详情</summary>
					<dl>
						{topicLabel ? <MetaDetail label="主题" value={topicLabel} /> : null}
						<MetaDetail label="文档集合" value={collectionLabel} />
						<MetaDetail label="版本" value={versionLabel} />
						<MetaDetail label="来源" value={sourceLabel} />
					</dl>
				</details>
			</div>
		</section>
	);
}

export function ReaderTable({ rows }: { rows: ReaderTableCell[][] }) {
	const expandedRows = expandTableRows(rows);
	const hasHeaderRow = rows[0]?.some((cell) => cell.tag === "th") ?? false;
	const hasMergedCells = rows.some((row) =>
		row.some((cell) => (cell.colSpan ?? 1) > 1 || (cell.rowSpan ?? 1) > 1),
	);
	const headers = expandedRows[0] ?? [];
	const dataRows = (hasHeaderRow ? expandedRows.slice(1) : expandedRows).filter((row) =>
		row.some(Boolean),
	);
	const renderCards = hasHeaderRow && shouldRenderMobileCards(headers, dataRows);
	return (
		<div
			className="docs-table-scroll"
			data-docs-scrollable="true"
			data-docs-sticky-first-column={hasMergedCells ? "false" : "true"}
			data-docs-table-kind={renderCards ? "mobile-cards" : "wide-scroll"}
		>
			{renderCards ? <ReaderTableCards dataRows={dataRows} headers={headers} /> : null}
			<table>
				<tbody>
					{rows.map((row, rowIndex) => (
						<tr key={rowKey(row, rowIndex)}>
							{row.map((cell, columnIndex) => {
								const Cell = cell.tag;
								return (
									<Cell
										colSpan={cell.colSpan}
										key={cellKey(cell, columnIndex)}
										role={cell.tag === "th" ? "columnheader" : undefined}
										rowSpan={cell.rowSpan}
									>
										{cell.text}
									</Cell>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function ReaderMarkdownTable(props: ComponentProps<"table">) {
	return (
		<div
			className="docs-table-scroll"
			data-docs-scrollable="true"
			data-docs-sticky-first-column="true"
			data-docs-table-kind="wide-scroll"
		>
			<table {...props} />
		</div>
	);
}

function ReaderTableCards({ dataRows, headers }: { dataRows: string[][]; headers: string[] }) {
	const keyedRows = withOccurrenceKeys(dataRows, (row) => row.join("\u0000"));
	return (
		<section aria-label="表格移动端按行阅读" className="docs-table-mobile-cards">
			<div className="docs-table-mobile-card-list">
				{keyedRows.map(({ item: row, key }, rowIndex) => {
					const summary = buildMobileTableRowSummary(headers, row, rowIndex);
					return (
						<article className="docs-table-mobile-card" key={key}>
							<p className="docs-table-mobile-card-title">{summary.title}</p>
							<dl>
								{buildMobileTableRowPairs(headers, row, summary.titleColumnIndex).map(
									({ header, value }) => (
										<div key={`${header}\u0000${value}`}>
											<dt>{header}</dt>
											<dd>{value}</dd>
										</div>
									),
								)}
							</dl>
						</article>
					);
				})}
			</div>
		</section>
	);
}

function withOccurrenceKeys<T>(items: T[], resolveKey: (item: T) => string) {
	const occurrences = new Map<string, number>();
	return items.map((item) => {
		const baseKey = resolveKey(item);
		const occurrence = (occurrences.get(baseKey) ?? 0) + 1;
		occurrences.set(baseKey, occurrence);
		return { item, key: `${baseKey}\u0000${occurrence}` };
	});
}

function MetaDetail({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt>{label}</dt>
			<dd>{value}</dd>
		</div>
	);
}

function readBrowserLocationState(): ReaderLocationState {
	return typeof window === "undefined"
		? EMPTY_READER_STATE
		: parseReaderLocationState(window.location.href);
}

function buildReaderPermalink(input: { anchor: string; rootUnitId: string | null }): string {
	const url = new URL(window.location.href);
	url.search = "";
	url.hash = "";
	if (input.rootUnitId) {
		url.searchParams.set("hl", input.rootUnitId);
	}
	url.hash = input.anchor;
	return url.toString();
}

function expandTableRows(rows: ReaderTableCell[][]): string[][] {
	const activeRowspans = new Map<number, { remaining: number; text: string }>();
	return rows.map((row) => {
		const expandedRow: string[] = [];
		let columnIndex = 0;
		const consumeRowspans = () => {
			while (activeRowspans.has(columnIndex)) {
				const active = activeRowspans.get(columnIndex);
				if (!active) {
					break;
				}
				expandedRow.push(active.text);
				if (active.remaining <= 1) {
					activeRowspans.delete(columnIndex);
				} else {
					activeRowspans.set(columnIndex, { ...active, remaining: active.remaining - 1 });
				}
				columnIndex += 1;
			}
		};
		consumeRowspans();
		for (const cell of row) {
			consumeRowspans();
			const colSpan = Math.max(1, cell.colSpan ?? 1);
			const rowSpan = Math.max(1, cell.rowSpan ?? 1);
			for (let offset = 0; offset < colSpan; offset += 1) {
				expandedRow.push(normalizeText(cell.text));
				if (rowSpan > 1) {
					activeRowspans.set(columnIndex + offset, {
						remaining: rowSpan - 1,
						text: normalizeText(cell.text),
					});
				}
			}
			columnIndex += colSpan;
		}
		consumeRowspans();
		return expandedRow;
	});
}

function shouldRenderMobileCards(headers: string[], dataRows: string[][]): boolean {
	if (dataRows.length === 0) {
		return false;
	}
	if (dataRows.length <= 8 && headers.length <= 5) {
		return true;
	}
	const courseLike = /课程名称|课程名|课程号|学分|学时|修读性质|修读学期/u.test(headers.join(" "));
	return courseLike && dataRows.length <= 16 && headers.length <= 7;
}

function buildMobileTableRowSummary(
	headers: string[],
	row: string[],
	rowIndex: number,
): { title: string; titleColumnIndex: number | null } {
	const preferredColumn = headers.findIndex((header) =>
		/课程名称|课程名|项目|事项|环节|类别|模块|名称|要求|内容/u.test(header),
	);
	const preferredValue = normalizeText(row[preferredColumn]);
	if (preferredColumn >= 0 && /[\p{Script=Han}A-Za-z]/u.test(preferredValue)) {
		return { title: preferredValue, titleColumnIndex: preferredColumn };
	}
	const fallbackColumn = row
		.slice(0, 4)
		.map(normalizeText)
		.findIndex((value) => /[\p{Script=Han}A-Za-z]/u.test(value));
	return fallbackColumn >= 0
		? { title: normalizeText(row[fallbackColumn]), titleColumnIndex: fallbackColumn }
		: { title: `第 ${rowIndex + 1} 行`, titleColumnIndex: null };
}

function buildMobileTableRowPairs(
	headers: string[],
	row: string[],
	titleColumnIndex: number | null,
) {
	const pairs: Array<{ header: string; value: string }> = [];
	const seen = new Set<string>();
	const columnCount = Math.max(headers.length, row.length);
	for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
		if (columnIndex === titleColumnIndex) {
			continue;
		}
		const value = normalizeText(row[columnIndex]) || "未填写";
		const header = normalizeText(headers[columnIndex]) || "补充说明";
		const key = `${header}\u0000${value}`;
		if (!seen.has(key)) {
			seen.add(key);
			pairs.push({ header, value });
		}
	}
	return pairs;
}

function normalizeText(value: string | null | undefined): string {
	return (value ?? "").replace(/\s+/gu, " ").trim();
}

function rowKey(row: ReaderTableCell[], rowIndex: number): string {
	return `${row.map((cell) => `${cell.tag}:${cell.text}`).join("|")}-${rowIndex}`;
}

function cellKey(cell: ReaderTableCell, columnIndex: number): string {
	return `${cell.tag}:${cell.rowSpan ?? 1}:${cell.colSpan ?? 1}:${cell.text}-${columnIndex}`;
}
