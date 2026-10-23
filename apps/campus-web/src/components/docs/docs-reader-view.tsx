import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@campus-agent/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, ExternalLink, Maximize2 } from "lucide-react";
import type { ReactNode } from "react";

import type { DocsDocumentRouteData } from "@/features/docs/data-source";
import type {
	DocsCourseMap,
	DocsReaderBlock,
	DocsReaderElement,
	DocsReaderPayload,
} from "@/features/docs/model";
import {
	ReaderBlock,
	ReaderDocument,
	ReaderDocumentMeta,
	ReaderHeading,
	ReaderTable,
} from "./reader-components";

export interface DocsOutlineItem {
	anchor: string;
	level: 2 | 3 | 4 | 5 | 6;
	title: string;
}

export function DocsDocumentArticle({
	data,
	locationHref,
}: {
	data: DocsDocumentRouteData;
	locationHref: string;
}) {
	const navigate = useNavigate();
	if (!data.reader) {
		return null;
	}
	const reader = data.reader;
	const permalinkRootUnitIds = buildPermalinkRootUnitIds(reader);
	const courseMapsByTarget = groupCourseMaps(data.courseMaps);
	return (
		<ReaderDocument
			as="article"
			className="docs-native-article"
			locationHref={locationHref}
			permalinkRootUnitIds={permalinkRootUnitIds}
		>
			<header className="docs-document-header">
				<h1 id="document" tabIndex={-1}>
					{data.title}
				</h1>
				<ReaderDocumentMeta
					collectionLabel={
						data.topicLabel && data.topicLabel !== data.collectionLabel
							? data.collectionLabel
							: null
					}
					onVersionNavigate={(href) => void navigate({ to: href as never })}
					versionSlug={data.versionSlug}
					versions={data.versions}
				/>
			</header>
			<div className="docs-document-body">
				{withStableKeys(reader.elements, elementKey).map(({ item: element, key }) => (
					<DocsReaderElementView
						courseMaps={courseMapsByTarget.get(element.rootUnitId) ?? []}
						element={element}
						key={key}
					/>
				))}
			</div>
			<DocsDocumentNavigation data={data} />
		</ReaderDocument>
	);
}

function DocsDocumentNavigation({ data }: { data: DocsDocumentRouteData }) {
	const collection = data.siteIndex.collections.find(
		(item) => item.corpus === data.corpus && item.collection === data.collection,
	);
	const documents = data.topicId
		? data.siteIndex.collections
				.filter((item) => item.corpus === data.corpus)
				.flatMap((item) => item.documents)
				.filter((document) => document.topicId === data.topicId)
				.sort((left, right) => left.title.localeCompare(right.title, "zh-CN"))
		: collection?.documents;
	const currentIndex = documents?.findIndex((document) => document.docId === data.docId) ?? -1;
	if (!(documents && currentIndex >= 0)) {
		return null;
	}
	const previous = documents[currentIndex - 1];
	const next = documents[currentIndex + 1];
	if (!(previous || next)) {
		return null;
	}
	return (
		<nav aria-label="相邻文档" className="docs-document-navigation">
			{previous ? (
				<Link className="docs-document-previous" to={previous.canonicalUrl as never}>
					<ArrowLeft aria-hidden="true" />
					<span>
						<small>上一篇</small>
						<strong>{previous.title}</strong>
					</span>
				</Link>
			) : (
				<span aria-hidden="true" />
			)}
			{next ? (
				<Link className="docs-document-next" to={next.canonicalUrl as never}>
					<span>
						<small>下一篇</small>
						<strong>{next.title}</strong>
					</span>
					<ArrowRight aria-hidden="true" />
				</Link>
			) : null}
		</nav>
	);
}

export function buildDocsOutline(reader: DocsReaderPayload | null): DocsOutlineItem[] {
	if (!reader) {
		return [];
	}
	const result: DocsOutlineItem[] = [];
	for (const element of reader.elements) {
		if (element.kind === "heading") {
			result.push({
				anchor: element.anchor,
				level: element.level,
				title: element.text,
			});
		}
	}
	return result;
}

function DocsReaderElementView({
	courseMaps,
	element,
}: {
	courseMaps: DocsCourseMap[];
	element: DocsReaderElement;
}) {
	if (element.kind === "heading") {
		return (
			<>
				<ReaderHeading
					anchor={element.anchor}
					level={element.level}
					rootUnitId={element.rootUnitId}
					title={element.text}
				/>
				{courseMaps.map((courseMap) => (
					<DocsCourseMapFigure courseMap={courseMap} key={courseMap.mapId} />
				))}
			</>
		);
	}
	return <DocsReaderBlockView block={element} courseMaps={courseMaps} />;
}

function DocsReaderBlockView({
	block,
	courseMaps,
}: {
	block: DocsReaderBlock;
	courseMaps: DocsCourseMap[];
}) {
	return (
		<>
			<ReaderBlock rootUnitId={block.rootUnitId}>
				{block.kind === "table" ? (
					<ReaderTable
						rows={block.rows.map((row) =>
							row.map((cell) => ({
								...(cell.colSpan === undefined ? {} : { colSpan: cell.colSpan }),
								...(cell.rowSpan === undefined ? {} : { rowSpan: cell.rowSpan }),
								tag: cell.header ? "th" : "td",
								text: cell.text,
							})),
						)}
					/>
				) : (
					renderTextBlock(block)
				)}
			</ReaderBlock>
			{courseMaps.map((courseMap) => (
				<DocsCourseMapFigure courseMap={courseMap} key={courseMap.mapId} />
			))}
		</>
	);
}

export function DocsCourseMapFigure({ courseMap }: { courseMap: DocsCourseMap }) {
	return (
		<Dialog>
			<figure className="docs-course-map-figure">
				<DialogTrigger asChild>
					<button className="docs-course-map-frame" type="button">
						<CourseMapParts courseMap={courseMap} mode="preview" />
						<span className="docs-course-map-open">
							<Maximize2 aria-hidden="true" />
							查看大图
						</span>
					</button>
				</DialogTrigger>
				<figcaption>
					<span>{courseMap.title}</span>
					<CourseMapFileLinks courseMap={courseMap} />
				</figcaption>
			</figure>
			<DialogContent
				className="docs-course-map-dialog max-h-[calc(100dvh-2rem)] max-w-[min(96rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] p-4 sm:p-5"
				closeLabel="关闭课程地图"
			>
				<DialogTitle className="pr-12 text-base">{courseMap.title}</DialogTitle>
				<section aria-label={`${courseMap.title}大图`} className="docs-course-map-viewer">
					<CourseMapParts courseMap={courseMap} mode="viewer" />
				</section>
				<div className="docs-course-map-dialog-links">
					<CourseMapFileLinks courseMap={courseMap} />
				</div>
			</DialogContent>
		</Dialog>
	);
}

function CourseMapParts({
	courseMap,
	mode,
}: {
	courseMap: DocsCourseMap;
	mode: "preview" | "viewer";
}) {
	const totalWidth = courseMap.parts.reduce((total, part) => total + part.width, 0);
	const maxHeight = Math.max(...courseMap.parts.map((part) => part.height));
	return (
		<div
			aria-label={courseMap.title}
			className={`docs-course-map-parts docs-course-map-parts-${mode}`}
			role="img"
			style={mode === "preview" ? { aspectRatio: `${totalWidth} / ${maxHeight}` } : undefined}
		>
			{courseMap.parts.map((part) => (
				<img
					alt=""
					className="docs-course-map-image"
					decoding="async"
					height={part.height}
					key={part.partId}
					loading={mode === "preview" ? "lazy" : "eager"}
					src={part.imageUrl}
					style={mode === "preview" ? { width: `${(part.width / totalWidth) * 100}%` } : undefined}
					width={part.width}
				/>
			))}
		</div>
	);
}

function CourseMapFileLinks({ courseMap }: { courseMap: DocsCourseMap }) {
	return (
		<span className="docs-course-map-file-links">
			{courseMap.parts.map((part, index) => (
				<a href={part.imageUrl} key={part.partId} rel="noreferrer" target="_blank">
					{courseMap.parts.length === 1 ? "打开原始文件" : `打开原图 ${index + 1}`}
					<ExternalLink aria-hidden="true" />
				</a>
			))}
		</span>
	);
}

function renderTextBlock(block: Exclude<DocsReaderBlock, { kind: "table" }>): ReactNode {
	if (block.kind === "blockquote") {
		return <blockquote>{block.text}</blockquote>;
	}
	if (block.kind === "list") {
		return (
			// biome-ignore lint/a11y/noRedundantRoles: WebKit may drop list semantics when markers are removed.
			<ul className="docs-reader-list" role="list">
				{withStableKeys(block.text.split(/\n+/u), (item) => item).map(({ item, key }) => (
					<li key={`${block.rootUnitId}:${key}`}>{item}</li>
				))}
			</ul>
		);
	}
	return withStableKeys(block.text.split(/\n{2,}/u), (paragraph) => paragraph).map(
		({ item: paragraph, key }) => <p key={`${block.rootUnitId}:${key}`}>{paragraph}</p>,
	);
}

function buildPermalinkRootUnitIds(reader: DocsReaderPayload): Record<string, string> {
	const result: Record<string, string> = {};
	for (const element of reader.elements) {
		if (element.kind === "heading") {
			result[element.anchor] = element.rootUnitId;
		}
	}
	return result;
}

function groupCourseMaps(courseMaps: DocsCourseMap[]): Map<string, DocsCourseMap[]> {
	const result = new Map<string, DocsCourseMap[]>();
	for (const courseMap of courseMaps) {
		result.set(courseMap.targetRootUnitId, [
			...(result.get(courseMap.targetRootUnitId) ?? []),
			courseMap,
		]);
	}
	return result;
}

function withStableKeys<T>(items: readonly T[], resolveBaseKey: (item: T) => string) {
	const seen = new Map<string, number>();
	return items.map((item) => {
		const baseKey = resolveBaseKey(item) || "item";
		const count = seen.get(baseKey) ?? 0;
		seen.set(baseKey, count + 1);
		return { item, key: count === 0 ? baseKey : `${baseKey}-${count}` };
	});
}

function elementKey(element: DocsReaderElement): string {
	return element.rootUnitId;
}
