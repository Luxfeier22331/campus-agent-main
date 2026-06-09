import { useLocation } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/shell/state-panels";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getDocsNavigation, resolveDocument, searchDocs } from "@/features/docs/api";
import type {
	DocsNavigationResponse,
	DocsResolveResponse,
	DocsSearchResponse,
} from "@/features/docs/model";

const DEFAULT_DOCS = {
	collection: "student_rules",
	corpus: "regulations",
	documentSlug: "index",
};

export function DocsPage() {
	const location = useLocation();
	const routeParts = useMemo(() => parseDocsPath(location.pathname), [location.pathname]);
	const [navigation, setNavigation] = useState<DocsNavigationResponse | null>(null);
	const [document, setDocument] = useState<DocsResolveResponse | null>(null);
	const [search, setSearch] = useState<DocsSearchResponse | null>(null);
	const [query, setQuery] = useState("");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		Promise.all([
			getDocsNavigation(routeParts),
			resolveDocument({
				...routeParts,
				documentSlug: routeParts.documentSlug,
			}),
		])
			.then(([nextNavigation, nextDocument]) => {
				setNavigation(nextNavigation);
				setDocument(nextDocument);
				setError(null);
			})
			.catch(() => {
				setError("文档暂时无法打开。");
			});
	}, [routeParts]);

	async function handleSearch() {
		if (!query.trim()) {
			setSearch(null);
			return;
		}
		try {
			setSearch(await searchDocs({ ...routeParts, query }));
		} catch {
			setError("搜索暂时不可用。");
		}
	}

	return (
		<div className="mx-auto grid max-w-[1440px] gap-6 px-5 py-8 pb-24 lg:grid-cols-[var(--layout-docs-sidebar-width)_minmax(0,var(--layout-docs-content-width))_var(--layout-docs-toc-width)] lg:px-6">
			<aside className="hidden lg:block">
				<Card className="sticky top-20 p-3">
					<p className="px-3 py-2 text-xs font-medium text-[var(--sys-text-subtle)]">
						{navigation?.collection.displayName ?? "文档"}
					</p>
					<div className="space-y-1">
						{navigation?.nodes.map((node) => (
							<a
								className="block rounded-lg px-3 py-2 text-sm text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]"
								href={node.canonicalUrl}
								key={`${node.kind}-${node.documentSlug}-${node.title}`}
							>
								{node.title}
							</a>
						))}
					</div>
				</Card>
			</aside>
			<section className="min-w-0">
				<div className="mb-6 flex gap-2">
					<Input
						aria-label="搜索文档"
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								void handleSearch();
							}
						}}
						placeholder="搜索文档"
						value={query}
					/>
					<button
						aria-label="搜索"
						className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary text-white"
						onClick={handleSearch}
						type="button"
					>
						<Search aria-hidden="true" className="size-5" />
					</button>
				</div>
				{error ? <ErrorPanel message={error} /> : null}
				{search ? (
					<SearchResults search={search} />
				) : document ? (
					<DocumentReader
						collectionLabel={navigation?.collection.displayName ?? "校园文档"}
						document={document}
					/>
				) : (
					<LoadingPanel label="正在读取文档" />
				)}
			</section>
			<aside className="hidden lg:block">
				<Card className="sticky top-20 p-4 text-sm text-[var(--sys-text-muted)]">
					<p className="font-medium text-[var(--sys-text-strong)]">本页信息</p>
					<p className="mt-3">资料来源：{navigation?.collection.displayName ?? "校园文档"}</p>
					<p className="mt-2">版本：{document?.resolvedVersion.label ?? "当前版"}</p>
				</Card>
			</aside>
		</div>
	);
}

function DocumentReader({
	collectionLabel,
	document,
}: {
	collectionLabel: string;
	document: DocsResolveResponse;
}) {
	return (
		<article className="rounded-2xl border border-border bg-white p-6 md:p-8">
			<p className="text-sm font-medium text-primary">{collectionLabel}</p>
			<h1 className="mt-3 text-3xl font-semibold tracking-normal text-[var(--sys-text-strong)]">
				{document.document.title}
			</h1>
			<p className="mt-4 text-sm text-[var(--sys-text-muted)]">
				更新：{new Date(document.document.updatedAt).toLocaleDateString("zh-CN")}
			</p>
			<div className="mt-8 rounded-xl bg-[var(--sys-bg-subtle)] p-5 text-sm leading-7 text-[var(--sys-text-muted)]">
				<p>完整正文可在文档页面中查看。</p>
				<a
					className="mt-3 inline-flex font-medium text-primary"
					href={document.readerAsset.contentUrl}
				>
					打开文档正文
				</a>
			</div>
		</article>
	);
}

function SearchResults({ search }: { search: DocsSearchResponse }) {
	if (search.results.length === 0) {
		return <EmptyPanel message="没有找到匹配的文档结果。" />;
	}
	return (
		<div className="space-y-3">
			{search.results.map((result) => (
				<Card className="p-4" key={`${result.canonicalUrl}-${result.anchor}`}>
					<a
						className="text-base font-medium text-[var(--sys-text-strong)]"
						href={result.canonicalUrl}
					>
						{result.title}
					</a>
					<p className="mt-2 text-sm leading-6 text-[var(--sys-text-muted)]">{result.snippet}</p>
				</Card>
			))}
		</div>
	);
}

function parseDocsPath(pathname: string) {
	const parts = pathname.split("/").filter(Boolean);
	return {
		collection: parts[2] ?? DEFAULT_DOCS.collection,
		corpus: parts[1] ?? DEFAULT_DOCS.corpus,
		documentSlug: parts[3] ?? DEFAULT_DOCS.documentSlug,
	};
}
