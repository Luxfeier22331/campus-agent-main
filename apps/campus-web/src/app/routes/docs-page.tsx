import { Link, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

import { DocsDocumentArticle } from "@/components/docs/docs-reader-view";
import type { DocsDirectoryRouteData, DocsRouteData } from "@/features/docs/data-source";
import { resolveDocsPageMetadata } from "@/features/docs/page-metadata";

export function DocsPage({ data: routeData }: { data: DocsRouteData }) {
	const location = useLocation();

	return (
		<>
			<DocsPageMetadata data={routeData} />
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
		</>
	);
}

function DocsPageMetadata({ data }: { data: DocsRouteData }) {
	const metadata = resolveDocsPageMetadata(data);
	useEffect(() => {
		document.title = `${metadata.title} | 中央民族大学校园问答`;
		setDocsMeta("description", metadata.description);
		setDocsMeta("robots", metadata.robots);
		setDocsCanonical(metadata.canonicalPath);
		return () => {
			for (const element of document.head.querySelectorAll("[data-campus-docs-metadata='true']")) {
				element.remove();
			}
		};
	}, [metadata.canonicalPath, metadata.description, metadata.robots, metadata.title]);
	return null;
}

function setDocsMeta(name: string, content: string): void {
	const selector = `meta[name='${name}']`;
	const element =
		document.head.querySelector<HTMLMetaElement>(selector) ?? document.createElement("meta");
	element.name = name;
	element.content = content;
	element.dataset.campusDocsMetadata = "true";
	if (!element.isConnected) {
		document.head.appendChild(element);
	}
}

function setDocsCanonical(href: string | null): void {
	const existing = document.head.querySelector<HTMLLinkElement>("link[rel='canonical']");
	if (!href) {
		existing?.remove();
		return;
	}
	const element = existing ?? document.createElement("link");
	element.rel = "canonical";
	element.href = new URL(href, window.location.origin).toString();
	element.dataset.campusDocsMetadata = "true";
	if (!element.isConnected) {
		document.head.appendChild(element);
	}
}

function DocsStartPage({ data }: { data: DocsDirectoryRouteData }) {
	const documentCount = data.siteIndex.collections.reduce(
		(total, collection) => total + collection.documents.length,
		0,
	);
	return (
		<section className="docs-start-page">
			<h1 tabIndex={-1}>校园文档</h1>
			<p>{documentCount} 篇公开文档</p>
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
