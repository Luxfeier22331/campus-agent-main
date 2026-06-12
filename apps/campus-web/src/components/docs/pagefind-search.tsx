import { Search, X } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

const PAGEFIND_BUNDLE_PATH = "/pagefind/";
const SEARCH_UNITS_PATH = "/pagefind/campus-docs-search-units.json";
const SEARCH_INPUT_ID = "campus-docs-pagefind-search-input";

interface PagefindModule {
	init?: () => Promise<void> | void;
	search: (
		term: string,
		options?: { excerptLength?: number },
	) => Promise<{ results: PagefindSearchResult[] }>;
	options?: (options: { baseUrl?: string; bundlePath?: string }) => Promise<void> | void;
}

declare global {
	interface Window {
		__campusPagefindModule?: PagefindModule;
	}
}

interface PagefindSearchResult {
	data: () => Promise<PagefindResultData>;
	id: string;
	score: number;
}

interface PagefindResultData {
	content?: string;
	excerpt?: string;
	meta?: { title?: string };
	sub_results?: PagefindSubResult[];
	url: string;
}

interface PagefindSubResult {
	excerpt?: string;
	title?: string;
	url: string;
}

interface SearchUnit {
	anchor: string;
	canonicalUrl: string;
	documentSlug: string;
	documentTitle?: string;
	highlightRootUnitIds: string[];
	snippet?: string;
	title: string;
	versionSlug: string;
}

interface SearchUnitsPayload {
	units: SearchUnit[];
}

interface DisplayResult {
	excerpt: string;
	title: string;
	url: string;
}

type SearchStatus = "idle" | "loading" | "ready" | "error";

let pagefindModulePromise: Promise<PagefindModule> | null = null;
let searchUnitsPromise: Promise<SearchUnit[]> | null = null;

function loadPagefindModule(): Promise<PagefindModule> {
	if (!pagefindModulePromise) {
		pagefindModulePromise = loadPagefindScript().then(async (module) => {
			await module.options?.({ bundlePath: PAGEFIND_BUNDLE_PATH });
			await module.init?.();
			return module;
		});
	}
	return pagefindModulePromise;
}

function loadPagefindScript(): Promise<PagefindModule> {
	if (window.__campusPagefindModule) {
		return Promise.resolve(window.__campusPagefindModule);
	}
	return new Promise((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(
			'script[data-campus-pagefind-loader="true"]',
		);
		if (existing) {
			existing.addEventListener("load", () => resolveLoadedPagefind(resolve, reject), {
				once: true,
			});
			existing.addEventListener("error", reject, { once: true });
			return;
		}
		const script = document.createElement("script");
		script.dataset.campusPagefindLoader = "true";
		script.type = "module";
		script.textContent = `import * as pagefind from "/pagefind/pagefind.js"; window.__campusPagefindModule = pagefind; window.dispatchEvent(new Event("campus-pagefind-ready"));`;
		const handleReady = () => resolveLoadedPagefind(resolve, reject);
		window.addEventListener("campus-pagefind-ready", handleReady, { once: true });
		script.addEventListener("error", reject, { once: true });
		document.head.appendChild(script);
	});
}

function resolveLoadedPagefind(
	resolve: (module: PagefindModule) => void,
	reject: (reason?: unknown) => void,
): void {
	if (window.__campusPagefindModule) {
		resolve(window.__campusPagefindModule);
		return;
	}
	reject(new Error("Pagefind module failed to initialize."));
}

async function loadSearchUnits(): Promise<SearchUnit[]> {
	if (!searchUnitsPromise) {
		searchUnitsPromise = fetch(SEARCH_UNITS_PATH, {
			headers: { accept: "application/json" },
		}).then(async (response) => {
			if (!response.ok) {
				throw new Error("Pagefind search units are unavailable.");
			}
			const payload = (await response.json()) as SearchUnitsPayload;
			return Array.isArray(payload.units) ? payload.units : [];
		});
	}
	return searchUnitsPromise;
}

function stripHtml(value: string | undefined): string {
	return (value ?? "")
		.replace(/<[^>]*>/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeResultUrl(url: string): string {
	const absolute = new URL(url, window.location.origin);
	return `${absolute.pathname}${absolute.hash}`.replace(/\/index\.html$/u, "/");
}

function buildReaderPermalink(unit: SearchUnit): string {
	const params = new URLSearchParams();
	if (unit.highlightRootUnitIds.length > 0) {
		params.set("hl", unit.highlightRootUnitIds.join(","));
	}
	const query = params.toString();
	return `${unit.canonicalUrl}${query ? `?${query}` : ""}#${encodeURIComponent(unit.anchor)}`;
}

function resolveSearchUnit(url: string, units: SearchUnit[]): SearchUnit | null {
	const normalized = normalizeResultUrl(url);
	const [path, hash = ""] = normalized.split("#", 2);
	const anchor = decodeURIComponent(hash);
	return (
		units.find((unit) => unit.canonicalUrl === path && unit.anchor === anchor) ??
		units.find((unit) => unit.canonicalUrl === path) ??
		null
	);
}

async function searchDocs(term: string): Promise<DisplayResult[]> {
	const [pagefind, units] = await Promise.all([loadPagefindModule(), loadSearchUnits()]);
	const response = await pagefind.search(term, { excerptLength: 24 });
	const displayResults: DisplayResult[] = [];
	for (const result of response.results.slice(0, 8)) {
		const data = await result.data();
		const subResults = data.sub_results ?? [];
		const candidates =
			subResults.length > 0
				? subResults
				: [{ excerpt: data.excerpt, title: data.meta?.title, url: data.url }];
		for (const candidate of candidates.slice(0, 3)) {
			const unit = resolveSearchUnit(candidate.url, units);
			displayResults.push({
				excerpt: stripHtml(unit?.snippet ?? candidate.excerpt ?? data.excerpt),
				title: unit?.title ?? stripHtml(candidate.title ?? data.meta?.title ?? "文档结果"),
				url: unit ? buildReaderPermalink(unit) : normalizeResultUrl(candidate.url),
			});
		}
	}
	const seen = new Set<string>();
	return displayResults.filter((result) => {
		if (seen.has(result.url)) {
			return false;
		}
		seen.add(result.url);
		return true;
	});
}

export default function PagefindSearch(): ReactElement {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [status, setStatus] = useState<SearchStatus>("idle");
	const [results, setResults] = useState<DisplayResult[]>([]);
	const inputRef = useRef<HTMLInputElement>(null);
	const trimmedQuery = query.trim();

	useEffect(() => {
		if (!open) {
			return;
		}
		const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
		return () => window.cancelAnimationFrame(frame);
	}, [open]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "/" && !isTextEntryTarget(event.target)) {
				event.preventDefault();
				setOpen(true);
			}
			if (event.key === "Escape") {
				setOpen(false);
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, []);

	useEffect(() => {
		if (!open || trimmedQuery.length === 0) {
			setResults([]);
			setStatus("idle");
			return;
		}
		let cancelled = false;
		setStatus("loading");
		const timeout = window.setTimeout(() => {
			searchDocs(trimmedQuery)
				.then((nextResults) => {
					if (cancelled) {
						return;
					}
					setResults(nextResults);
					setStatus("ready");
				})
				.catch(() => {
					if (cancelled) {
						return;
					}
					setResults([]);
					setStatus("error");
				});
		}, 180);
		return () => {
			cancelled = true;
			window.clearTimeout(timeout);
		};
	}, [open, trimmedQuery]);

	const statusText = useMemo(() => {
		if (status === "loading") {
			return "正在搜索";
		}
		if (status === "error") {
			return "搜索暂不可用";
		}
		if (trimmedQuery && results.length === 0) {
			return "未找到相关文档";
		}
		return "输入关键词搜索公开文档";
	}, [results.length, status, trimmedQuery]);

	return (
		<>
			<button
				aria-label="搜索公开文档"
				className="docs-pagefind-trigger"
				onClick={() => setOpen(true)}
				type="button"
			>
				<Search aria-hidden="true" size={17} />
				<span>搜索</span>
			</button>
			{open ? (
				<div aria-modal="true" className="docs-pagefind-modal" role="dialog">
					<button
						aria-label="关闭搜索"
						className="docs-pagefind-backdrop"
						onClick={() => setOpen(false)}
						type="button"
					/>
					<div className="docs-pagefind-panel">
						<div className="docs-pagefind-searchbox">
							<Search aria-hidden="true" size={18} />
							<input
								aria-label="搜索公开文档"
								autoComplete="off"
								id={SEARCH_INPUT_ID}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="搜索公开文档"
								ref={inputRef}
								type="search"
								value={query}
							/>
							<button
								aria-label="关闭搜索"
								className="docs-pagefind-close"
								onClick={() => setOpen(false)}
								type="button"
							>
								<X aria-hidden="true" size={18} />
							</button>
						</div>
						<p className="docs-pagefind-status" role="status">
							{statusText}
						</p>
						<div className="docs-pagefind-results">
							{results.map((result) => (
								<a
									className="docs-pagefind-result"
									href={result.url}
									key={result.url}
									onClick={() => setOpen(false)}
								>
									<span>{result.title}</span>
									{result.excerpt ? <small>{result.excerpt}</small> : null}
								</a>
							))}
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}

function isTextEntryTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target.isContentEditable ||
		target.getAttribute("role") === "textbox"
	);
}
