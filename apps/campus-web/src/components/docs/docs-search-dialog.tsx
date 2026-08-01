import { Button, Skeleton } from "@campus-agent/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
} from "@/features/docs/search-client";
import { normalizeDocsSearchQuery } from "@/features/docs/search-query";
import type { DocsSiteIndex } from "@/features/docs/site-index";

const INITIAL_VISIBLE_DOCUMENTS = 8;
const DOCUMENTS_PAGE_SIZE = 8;
const INITIAL_VISIBLE_SECTIONS = 3;

export function DocsSearchPanel({
	onNavigate,
	searchIndexUrl,
	siteIndex,
}: {
	onNavigate: () => void;
	searchIndexUrl: string;
	siteIndex: DocsSiteIndex;
}) {
	const navigate = useNavigate();
	const [searchClient, setSearchClient] = useState<DocsSearchClient | null>(null);
	const [query, setQuery] = useState("");
	const [documentGroups, setDocumentGroups] = useState<DocsSearchDocumentGroup[]>([]);
	const [totalDocumentCount, setTotalDocumentCount] = useState(0);
	const [searching, setSearching] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [status, setStatus] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
	const [expandedDocuments, setExpandedDocuments] = useState<Set<string>>(() => new Set());
	const inputRef = useRef<HTMLInputElement>(null);
	const querySequence = useRef(0);

	useEffect(() => {
		let active = true;
		const client = loadDocsSearchClient({ searchIndexUrl, siteIndex });
		setStatus("loading");
		setSearchClient(null);
		setDocumentGroups([]);
		setTotalDocumentCount(0);
		setExpandedDocuments(new Set());
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
		};
	}, [searchIndexUrl, siteIndex]);

	const normalizedQuery = normalizeDocsSearchQuery(query);
	useEffect(() => {
		const sequence = ++querySequence.current;
		if (!(searchClient && normalizedQuery)) {
			setDocumentGroups([]);
			setTotalDocumentCount(0);
			setSearching(false);
			setLoadingMore(false);
			return;
		}
		setDocumentGroups([]);
		setTotalDocumentCount(0);
		setSearching(true);
		setLoadingMore(false);
		const timeout = window.setTimeout(() => {
			void searchClient
				.search({
					documentLimit: INITIAL_VISIBLE_DOCUMENTS,
					documentOffset: 0,
					query: normalizedQuery,
				})
				.then((response) => {
					if (sequence !== querySequence.current) {
						return;
					}
					setDocumentGroups(response.documentGroups);
					setTotalDocumentCount(response.totalDocumentCount);
					setSearching(false);
				})
				.catch(() => {
					if (sequence !== querySequence.current) {
						return;
					}
					setDocumentGroups([]);
					setTotalDocumentCount(0);
					setSearching(false);
					setStatus("unavailable");
				});
		}, 80);
		return () => window.clearTimeout(timeout);
	}, [normalizedQuery, searchClient]);

	useEffect(() => inputRef.current?.focus(), []);

	function updateQuery(value: string) {
		setQuery(value);
		setExpandedDocuments(new Set());
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
			.expand(normalizedQuery, docId)
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
				setStatus("unavailable");
			});
	}

	function loadMoreDocuments() {
		if (
			!(searchClient && normalizedQuery) ||
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
				query: normalizedQuery,
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
				setStatus("unavailable");
			});
	}

	function selectResult(url: string) {
		onNavigate();
		void navigate({ to: url as never });
	}

	return (
		<Command label="搜索校园文档" shouldFilter={false}>
			<CommandInput
				aria-label="搜索校园文档"
				className="h-11 pr-10"
				name="docs-search-query"
				onValueChange={updateQuery}
				placeholder="搜索标题、章节或正文"
				ref={inputRef}
				value={query}
			/>
			<CommandList className="max-h-[min(70dvh,36rem)]">
				{status === "loading" ? (
					<div className="grid gap-3 px-4 py-5" role="status">
						<p className="m-0 text-sm text-muted-foreground">正在载入搜索索引</p>
						<div aria-hidden="true" className="grid gap-2">
							<Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
							<Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
						</div>
					</div>
				) : null}
				{status === "unavailable" ? (
					<p className="px-4 py-8 text-center text-sm text-muted-foreground" role="alert">
						搜索暂时不可用，请刷新页面后重试
					</p>
				) : null}
				{status === "ready" && normalizedQuery && searching ? (
					<p className="px-4 py-8 text-center text-sm text-muted-foreground" role="status">
						正在搜索
					</p>
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
												query={normalizedQuery}
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
														<DocsSearchHighlight
															query={normalizedQuery}
															text={entry.sectionTitle}
														/>
													</span>
													<span className="docs-search-result-snippet">
														<DocsSearchHighlight query={normalizedQuery} text={entry.snippet} />
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
