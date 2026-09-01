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

import { parseReaderLocationState, type ReaderLocationState } from "@/features/docs/reader-state";
import { compareDocsVersionSlugs, formatDocsVersionLabel } from "@/features/docs/version";

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
	canonicalUrl: string;
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
	rootUnitId?: string | undefined;
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
	rootUnitId?: string | undefined;
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
		<div className="docs-reader-heading-row" data-docs-heading-level={level}>
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
	rootUnitId?: string | null | undefined;
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
	collectionLabel,
	onVersionNavigate,
	topicLabel,
	versionSlug,
	versions,
}: {
	collectionLabel: string;
	onVersionNavigate?: (href: string) => void;
	topicLabel: string | null;
	versionSlug: string;
	versions?: ReaderVersion[];
}) {
	const resolvedVersions = versions ?? [];
	const hasMultipleVersions = resolvedVersions.length > 1;
	const latestVersionSlug = resolvedVersions.reduce(
		(current, version) =>
			!current || compareDocsVersionSlugs(version.versionSlug, current) > 0
				? version.versionSlug
				: current,
		"",
	);
	const isLatest = !latestVersionSlug || versionSlug === latestVersionSlug;
	const versionLabel = formatDocsVersionLabel(versionSlug);

	function selectVersion(nextVersionSlug: string) {
		const version = resolvedVersions.find((item) => item.versionSlug === nextVersionSlug);
		if (!version) {
			return;
		}
		if (onVersionNavigate) {
			onVersionNavigate(version.canonicalUrl);
			return;
		}
		window.location.assign(version.canonicalUrl);
	}

	return (
		<section
			aria-label="文档信息与版本"
			className="document-meta-panel"
			data-docs-reader-meta="true"
			data-docs-version-slug={versionSlug}
		>
			<p className="document-meta-summary">
				{hasMultipleVersions ? null : <span>{versionLabel}</span>}
				{topicLabel ? <span>主题：{topicLabel}</span> : null}
				<span>{collectionLabel}</span>
			</p>
			{isLatest && !hasMultipleVersions ? null : (
				<div className="document-meta-controls">
					{isLatest ? null : (
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
											{formatDocsVersionLabel(version.versionSlug)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					) : null}
				</div>
			)}
		</section>
	);
}

export function ReaderTable({ rows }: { rows: ReaderTableCell[][] }) {
	return (
		<ReaderTableScroll>
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
		</ReaderTableScroll>
	);
}

export function ReaderMarkdownTable(props: ComponentProps<"table">) {
	return (
		<ReaderTableScroll>
			<table {...props} />
		</ReaderTableScroll>
	);
}

function ReaderTableScroll({ children }: { children: ReactNode }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [overflowing, setOverflowing] = useState(false);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		const measureOverflow = () => {
			setOverflowing(container.scrollWidth > container.clientWidth + 1);
		};
		const observer = new ResizeObserver(measureOverflow);
		measureOverflow();
		observer.observe(container);
		const table = container.querySelector("table");
		if (table) {
			observer.observe(table);
		}
		return () => observer.disconnect();
	}, []);

	return (
		<div
			className="docs-table-scroll"
			data-docs-overflowing={String(overflowing)}
			data-docs-scrollable="true"
			ref={containerRef}
			tabIndex={overflowing ? 0 : undefined}
		>
			{children}
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

function rowKey(row: ReaderTableCell[], rowIndex: number): string {
	return `${row.map((cell) => `${cell.tag}:${cell.text}`).join("|")}-${rowIndex}`;
}

function cellKey(cell: ReaderTableCell, columnIndex: number): string {
	return `${cell.tag}:${cell.rowSpan ?? 1}:${cell.colSpan ?? 1}:${cell.text}-${columnIndex}`;
}
