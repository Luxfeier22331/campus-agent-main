import { Button, Skeleton } from "@campus-agent/ui";
import { useDebouncer, useThrottler } from "@tanstack/react-pacer";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
	Command,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	type DocsSearchClient,
	type DocsSearchDocumentGroup,
	loadDocsSearchClient,
	resetDocsSearchClient,
} from "@/features/docs/search-client";
import { normalizeDocsSearchQuery } from "@/features/docs/search-query";
import type { DocsSiteIndex } from "@/features/docs/site-index";

const INITIAL_VISIBLE_DOCUMENTS = 8;
const DOCUMENTS_PAGE_SIZE = 8;
const INITIAL_VISIBLE_SECTIONS = 3;
const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_MAX_WAIT_MS = 500;

export interface DocsSearchRuntime {
	load: typeof loadDocsSearchClient;
	reset: typeof resetDocsSearchClient;
}

export function DocsSearchPanel({
	initialQuery = "",
	onNavigate,
	searchIndexUrl,
	searchRuntime,
	siteIndex,
}: {
	initialQuery?: string;
	onNavigate: () => void;
	searchIndexUrl: string;
	searchRuntime?: DocsSearchRuntime;
	siteIndex: DocsSiteIndex;
}) {
	const navigate = useNavigate();
	const searchScopeId = useId();
	const [searchClient, setSearchClient] = useState<DocsSearchClient | null>(null);
	const [query, setQuery] = useState(initialQuery);
	const [activeQuery, setActiveQuery] = useState("");
	const [documentGroups, setDocumentGroups] = useState<DocsSearchDocumentGroup[]>([]);
	const [totalDocumentCount, setTotalDocumentCount] = useState(0);
	const [searching, setSearching] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [status, setStatus] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
	const [searchError, setSearchError] = useState(false);
	const [retryAttempt, setRetryAttempt] = useState(0);
	const [expandedDocuments, setExpandedDocuments] = useState<Set<string>>(() => new Set());
	const inputRef = useRef<HTMLInputElement>(null);
	const querySequence = useRef(0);
	const executedQuerySequence = useRef(0);
	const normalizedQueryRef = useRef("");
	const loadSearchClient = searchRuntime?.load ?? loadDocsSearchClient;
	const resetSearchClient = searchRuntime?.reset ?? resetDocsSearchClient;

	function executeSearch(client: DocsSearchClient, searchQuery: string, sequence: number) {
		if (sequence !== querySequence.current || sequence === executedQuerySequence.current) {
			return;
		}
		executedQuerySequence.current = sequence;
		void client
			.search({
				documentLimit: INITIAL_VISIBLE_DOCUMENTS,
				documentOffset: 0,
				query: searchQuery,
			})
			.then((response) => {
				if (sequence !== querySequence.current) {
					return;
				}
				setActiveQuery(searchQuery);
				setDocumentGroups(response.documentGroups);
				setTotalDocumentCount(response.totalDocumentCount);
				setSearching(false);
				setSearchError(false);
			})
			.catch(() => {
				if (sequence !== querySequence.current) {
					return;
				}
				setSearching(false);
				setSearchError(true);
			});
	}

	const searchDebouncer = useDebouncer(executeSearch, {
		leading: false,
		trailing: true,
		wait: SEARCH_DEBOUNCE_MS,
	});
	const searchMaxWaitThrottler = useThrottler(executeSearch, {
		leading: false,
		trailing: true,
		wait: SEARCH_MAX_WAIT_MS,
	});

	useEffect(() => {
		let active = true;
		if (retryAttempt > 0) {
			resetSearchClient(searchIndexUrl);
		}
		const client = loadSearchClient({ searchIndexUrl, siteIndex });
		querySequence.current += 1;
		searchDebouncer.cancel();
		searchMaxWaitThrottler.cancel();
		setStatus("loading");
		setSearchClient(null);
		setExpandedDocuments(new Set());
		setSearchError(false);
		setSearching(false);
		setLoadingMore(false);
		void client
			.ready()
			.then(() => {
				if (!active) {
					return;
				}
				setSearchClient(client);
				setStatus("ready");
			})
			.catch(() => {
				if (active) {
					setStatus("unavailable");
				}
			});
		return () => {
			active = false;
			querySequence.current += 1;
			searchDebouncer.cancel();
			searchMaxWaitThrottler.cancel();
		};
	}, [
		loadSearchClient,
		retryAttempt,
		resetSearchClient,
		searchDebouncer,
		searchIndexUrl,
		searchMaxWaitThrottler,
		siteIndex,
	]);

	const normalizedQuery = normalizeDocsSearchQuery(query);
	useEffect(() => {
		if (!(searchClient && normalizedQuery)) {
			searchDebouncer.cancel();
			searchMaxWaitThrottler.cancel();
			setActiveQuery("");
			setDocumentGroups([]);
			setTotalDocumentCount(0);
			setSearching(false);
			setLoadingMore(false);
			setSearchError(false);
			return;
		}
		const sequence = querySequence.current;
		setSearching(true);
		setSearchError(false);
		setLoadingMore(false);
		searchDebouncer.maybeExecute(searchClient, normalizedQuery, sequence);
		searchMaxWaitThrottler.maybeExecute(searchClient, normalizedQuery, sequence);
	}, [normalizedQuery, searchClient, searchDebouncer, searchMaxWaitThrottler]);

	useEffect(() => inputRef.current?.focus(), []);

	function updateQuery(value: string) {
		setQuery(value);
		setExpandedDocuments(new Set());
		const nextNormalizedQuery = normalizeDocsSearchQuery(value);
		if (nextNormalizedQuery === normalizedQueryRef.current) {
			return;
		}
		normalizedQueryRef.current = nextNormalizedQuery;
		querySequence.current += 1;
		if (!nextNormalizedQuery) {
			searchDebouncer.cancel();
			searchMaxWaitThrottler.cancel();
		}
	}

	function retrySearch() {
		if (!(searchClient && normalizedQuery)) {
			setRetryAttempt((attempt) => attempt + 1);
			return;
		}
		querySequence.current += 1;
		const sequence = querySequence.current;
		setSearching(true);
		setSearchError(false);
		searchDebouncer.maybeExecute(searchClient, normalizedQuery, sequence);
		searchMaxWaitThrottler.maybeExecute(searchClient, normalizedQuery, sequence);
	}

	function toggleDocument(docId: string) {
		if (!searchClient) {
			return;
		}
		const group = documentGroups.find((item) => item.document.docId === docId);
		if (!group) {
			return;
		}
		if (expandedDocuments.has(docId)) {
			setExpandedDocuments((current) => {
				const next = new Set(current);
				next.delete(docId);
				return next;
			});
			return;
		}
		if (group.isComplete) {
			setExpandedDocuments((current) => new Set(current).add(docId));
			return;
		}
		const sequence = querySequence.current;
		setSearching(true);
		void searchClient
			.expand(activeQuery, docId)
			.then((expandedGroup) => {
				if (sequence !== querySequence.current) {
					return;
				}
				setDocumentGroups((current) =>
					current.map((item) => (item.document.docId === docId ? expandedGroup : item)),
				);
				setExpandedDocuments((current) => new Set(current).add(docId));
				setSearching(false);
			})
			.catch(() => {
				if (sequence !== querySequence.current) {
					return;
				}
				setSearching(false);
				setSearchError(true);
			});
	}

	function loadMoreDocuments() {
		if (
			!(searchClient && activeQuery) ||
			loadingMore ||
			documentGroups.length >= totalDocumentCount
		) {
			return;
		}
		const sequence = querySequence.current;
		setLoadingMore(true);
		void searchClient
			.search({
				documentLimit: DOCUMENTS_PAGE_SIZE,
				documentOffset: documentGroups.length,
				query: activeQuery,
			})
			.then((response) => {
				if (sequence !== querySequence.current) {
					return;
				}
				setDocumentGroups((current) => [...current, ...response.documentGroups]);
				setTotalDocumentCount(response.totalDocumentCount);
				setLoadingMore(false);
			})
			.catch(() => {
				if (sequence !== querySequence.current) {
					return;
				}
				setLoadingMore(false);
				setSearchError(true);
			});
	}

	function selectResult(url: string) {
		onNavigate();
		void navigate({ to: url as never });
	}

	return (
		<Command className="docs-search-panel" label="搜索校园文档" shouldFilter={false}>
			<CommandInput
				aria-label="搜索校园文档"
				aria-describedby={searchScopeId}
				className="h-12 pr-10 text-base"
				name="docs-search-query"
				onValueChange={updateQuery}
				placeholder="搜索标题、章节或正文"
				ref={inputRef}
				value={query}
			/>
			<p className="docs-search-scope" id={searchScopeId}>
				搜索全部文档的当前版本
			</p>
			<CommandList
				aria-busy={status === "loading" || searching || loadingMore || undefined}
				className="max-h-[min(70dvh,36rem)]"
			>
				{status === "loading" && documentGroups.length === 0 && normalizedQuery ? (
					<div aria-hidden="true" className="grid gap-2 px-4 py-5">
						<Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
						<Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
					</div>
				) : null}
				{status === "unavailable" ? (
					<div className="grid gap-2 px-4 py-8 text-center" role="alert">
						<p className="m-0 text-sm text-muted-foreground">搜索暂时不可用。</p>
						<Button className="mx-auto" onClick={retrySearch} size="sm" variant="outline">
							重试搜索
						</Button>
					</div>
				) : null}
				{status === "ready" && normalizedQuery && searchError && documentGroups.length > 0 ? (
					<div
						className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-muted-foreground"
						role="alert"
					>
						<span>搜索结果暂时无法更新。</span>
						<Button onClick={retrySearch} size="sm" variant="ghost">
							重试
						</Button>
					</div>
				) : null}
				{status === "ready" && normalizedQuery && !searching && totalDocumentCount === 0 ? (
					<p className="px-4 py-8 text-center text-sm text-muted-foreground">没有找到相关文档</p>
				) : null}
				{status === "ready" && normalizedQuery && documentGroups.length > 0 ? (
					<CommandGroup heading={`${totalDocumentCount} 篇文档`}>
						{documentGroups.map((group) => {
							const expanded = expandedDocuments.has(group.document.docId);
							const visibleResults = expanded
								? group.results
								: group.results.slice(0, INITIAL_VISIBLE_SECTIONS);
							return (
								<section className="docs-search-document" key={group.document.docId}>
									<header className="docs-search-document-header">
										<span className="docs-search-result-title">
											<DocsSearchHighlight
												query={activeQuery}
												text={group.document.documentTitle}
											/>
										</span>
										<span className="docs-search-result-collection">
											{group.document.collectionLabel}
										</span>
									</header>
									{visibleResults.map(({ entry, url }) => {
										const resultId = `${entry.docId}:${entry.anchor}`;
										return (
											<CommandItem
												asChild
												key={resultId}
												onSelect={() => selectResult(url)}
												value={resultId}
											>
												<Link
													className="docs-search-result"
													onClick={(event) => event.preventDefault()}
													to={url as never}
												>
													<span className="docs-search-result-section">
														<DocsSearchHighlight query={activeQuery} text={entry.sectionTitle} />
													</span>
													<span className="docs-search-result-snippet">
														<DocsSearchHighlight query={activeQuery} text={entry.snippet} />
													</span>
												</Link>
											</CommandItem>
										);
									})}
									{group.totalSectionCount > INITIAL_VISIBLE_SECTIONS ? (
										<Button
											aria-expanded={expanded}
											className="docs-search-expand"
											onClick={() => toggleDocument(group.document.docId)}
											size="sm"
											type="button"
											variant="ghost"
										>
											<ChevronDown aria-hidden="true" />
											{expanded ? "收起章节" : `显示全部 ${group.totalSectionCount} 个章节`}
										</Button>
									) : null}
								</section>
							);
						})}
						{documentGroups.length < totalDocumentCount ? (
							<Button
								className="docs-search-more"
								disabled={loadingMore}
								onClick={loadMoreDocuments}
								type="button"
								variant="outline"
							>
								{loadingMore
									? "正在载入更多文档"
									: `继续显示文档（剩余 ${totalDocumentCount - documentGroups.length} 篇）`}
							</Button>
						) : null}
					</CommandGroup>
				) : null}
				{status === "ready" && !normalizedQuery ? (
					<p className="px-4 py-8 text-center text-sm text-muted-foreground">输入关键词开始搜索</p>
				) : null}
			</CommandList>
		</Command>
	);
}

function DocsSearchHighlight({ query, text }: { query: string; text: string }): ReactNode {
	const terms = [...new Set(query.split(" ").filter(Boolean))].sort(
		(left, right) => right.length - left.length,
	);
	if (terms.length === 0) {
		return text;
	}
	const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "giu");
	const fragments: ReactNode[] = [];
	let previousEnd = 0;
	for (const match of text.matchAll(pattern)) {
		const start = match.index;
		if (start > previousEnd) {
			fragments.push(text.slice(previousEnd, start));
		}
		fragments.push(<mark key={`${start}:${match[0]}`}>{match[0]}</mark>);
		previousEnd = start + match[0].length;
	}
	if (previousEnd < text.length) {
		fragments.push(text.slice(previousEnd));
	}
	return fragments;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
