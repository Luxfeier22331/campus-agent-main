import { Link, useLocation } from "@tanstack/react-router";

import { CampusPageMetadataHead } from "@/app/page-metadata-head";
import { DocsPageTransition } from "@/components/docs/docs-page-transition";
import { DocsDocumentArticle } from "@/components/docs/docs-reader-view";
import type { DocsDirectoryRouteData, DocsRouteData } from "@/features/docs/data-source";
import { resolveDocsPageMetadata } from "@/features/docs/page-metadata";
import { buildDocsNavigationGroups } from "@/features/docs/site-index";

export function DocsPage({
	data: routeData,
	renderMetadata = true,
}: {
	data: DocsRouteData;
	renderMetadata?: boolean;
}) {
	const location = useLocation();
	const metadata = resolveDocsPageMetadata(routeData);

	return (
		<>
			{renderMetadata ? <CampusPageMetadataHead metadata={metadata} /> : null}
			<DocsPageTransition
				key={
					routeData.kind === "directory"
						? "/docs"
						: `${routeData.canonicalUrl}:${routeData.versionSlug}`
				}
			>
				{routeData.kind === "directory" ? (
					<DocsStartPage data={routeData} />
				) : (
					<div className="docs-document-view">
						<DocsBreadcrumbs items={buildDocumentBreadcrumbs(routeData)} />
						<DocsDocumentArticle
							data={routeData}
							key={routeData.canonicalUrl}
							locationHref={location.href}
						/>
					</div>
				)}
			</DocsPageTransition>
		</>
	);
}

function DocsStartPage({ data }: { data: DocsDirectoryRouteData }) {
	const documentCount = data.siteIndex.collections.reduce(
		(total, collection) => total + collection.documents.length,
		0,
	);
	const groups = buildDocsNavigationGroups(data.siteIndex);
	return (
		<section className="docs-start-page">
			<header className="docs-start-header">
				<h1 tabIndex={-1}>校园文档</h1>
				<p>{documentCount} 篇公开文档</p>
			</header>
			<div className="docs-start-groups">
				{groups.map((group) => {
					const groupDocumentCount = group.sections.reduce(
						(total, section) => total + section.documents.length,
						0,
					);
					return (
						<section className="docs-start-corpus" key={group.corpus}>
							<header className="docs-start-corpus-header">
								<h2>{group.label}</h2>
								<span>{groupDocumentCount} 篇</span>
							</header>
							<div className="docs-start-sections">
								{group.sections.map((section) => (
									<details className="docs-start-section" key={section.key}>
										<summary>
											<span className="docs-start-section-title">{section.label}</span>
											<span className="docs-start-section-count">
												{section.documents.length} 篇
											</span>
										</summary>
										{section.description ? (
											<p className="docs-start-section-description">{section.description}</p>
										) : null}
										<ul className="docs-start-document-list">
											{section.documents.map((document) => (
												<li key={document.canonicalUrl}>
													<Link to={document.canonicalUrl as never}>{document.title}</Link>
												</li>
											))}
										</ul>
									</details>
								))}
							</div>
						</section>
					);
				})}
			</div>
		</section>
	);
}

interface DocsBreadcrumbItem {
	href?: string;
	label: string;
}

function DocsBreadcrumbs({ items }: { items: DocsBreadcrumbItem[] }) {
	const visibleItems = deduplicateBreadcrumbs(items);
	return (
		<nav aria-label="面包屑" className="docs-breadcrumbs">
			<ol>
				{visibleItems.map((item) => (
					<li key={`${item.href ?? "label"}:${item.label}`}>
						{item.href ? (
							<Link to={item.href as never}>{item.label}</Link>
						) : (
							<span>{item.label}</span>
						)}
					</li>
				))}
			</ol>
		</nav>
	);
}

function deduplicateBreadcrumbs(items: DocsBreadcrumbItem[]): DocsBreadcrumbItem[] {
	const labels = new Set<string>();
	const paths = new Set<string>();
	return [...items]
		.reverse()
		.filter((item) => {
			if (labels.has(item.label) || (item.href && paths.has(item.href))) {
				return false;
			}
			labels.add(item.label);
			if (item.href) {
				paths.add(item.href);
			}
			return true;
		})
		.reverse();
}

function resolveDocumentCorpusLabel(data: Extract<DocsRouteData, { kind: "document" }>): string {
	const collection = data.siteIndex.collections.find(
		(item) => item.corpus === data.corpus && item.collection === data.collection,
	);
	if (!collection) {
		throw new Error(
			`docs collection is missing from the site index: ${data.corpus}/${data.collection}`,
		);
	}
	return collection.corpusLabel;
}

function buildDocumentBreadcrumbs(
	data: Extract<DocsRouteData, { kind: "document" }>,
): DocsBreadcrumbItem[] {
	return [
		{ href: "/docs", label: "校园文档" },
		{ label: resolveDocumentCorpusLabel(data) },
		{ label: data.topicLabel ?? data.collectionLabel },
	];
}
