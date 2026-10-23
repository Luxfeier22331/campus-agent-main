import "@/components/docs/docs-reader.css";
import { DocsPage } from "@/components/docs/docs-page-view";
import { DocsSearchPanel, type DocsSearchRuntime } from "@/components/docs/docs-search-dialog";
import type { DocsDirectoryRouteData, DocsDocumentRouteData } from "@/features/docs/data-source";
import type { DocsReaderPayload } from "@/features/docs/model";
import type { DocsSearchClient, DocsSearchDocumentGroup } from "@/features/docs/search-client";
import { DOCS_SITE_INDEX_SCHEMA, type DocsSiteIndex } from "@/features/docs/site-index";
import type { StyleDevStory } from "../contracts";
import { StyleDevRouter } from "../providers";

const DOCS_SITE_INDEX: DocsSiteIndex = {
	collections: [
		{
			collection: "student-rules",
			corpus: "regulations",
			corpusLabel: "校园规章",
			description: null,
			documents: [
				{
					canonicalUrl: "/docs/regulations/student-rules/library-hours",
					docId: "library-hours",
					documentSlug: "library-hours",
					title: "图书馆开放时间",
					topicId: "campus-services",
					versions: [
						{
							canonicalUrl: "/docs/regulations/student-rules/library-hours",
							readerUrl: "/docs-content/library-hours.json",
							versionId: "library-hours-v1",
							versionSlug: "2026",
						},
					],
				},
			],
			label: "学生服务",
		},
	],
	redirects: [],
	searchIndexUrl: "/docs-content/search-index.json",
	schemaVersion: DOCS_SITE_INDEX_SCHEMA,
	topics: [
		{
			corpus: "regulations",
			description: null,
			displayName: "校园服务",
			order: 1,
			topicId: "campus-services",
		},
	],
};

const DOCS_SEARCH_GROUP: DocsSearchDocumentGroup = {
	document: {
		canonicalUrl: "/docs/regulations/student-rules/library-hours",
		collection: "student-rules",
		collectionLabel: "学生服务",
		corpus: "regulations",
		docId: "library-hours",
		documentTitle: "图书馆开放时间",
		topicId: "campus-services",
		topicLabel: "校园服务",
	},
	isComplete: true,
	results: [
		{
			document: {
				canonicalUrl: "/docs/regulations/student-rules/library-hours",
				collection: "student-rules",
				collectionLabel: "学生服务",
				corpus: "regulations",
				docId: "library-hours",
				documentTitle: "图书馆开放时间",
				topicId: "campus-services",
				topicLabel: "校园服务",
			},
			entry: {
				anchor: "opening-hours",
				docId: "library-hours",
				highlightRootUnitIds: ["opening-hours"],
				searchText: "东区图书馆 开放时间 闭馆",
				sectionTitle: "开放时间",
				snippet: "东区图书馆周一至周日开放至 22:00。",
			},
			url: "/docs/regulations/student-rules/library-hours#opening-hours",
		},
	],
	totalSectionCount: 1,
};

const DOCS_SEARCH_CLIENT: DocsSearchClient = {
	expand: async () => DOCS_SEARCH_GROUP,
	ready: async () => undefined,
	search: async ({ documentOffset }) => ({
		documentGroups: documentOffset === 0 ? [DOCS_SEARCH_GROUP] : [],
		documentOffset,
		totalDocumentCount: 1,
	}),
};

const DOCS_SEARCH_RUNTIME: DocsSearchRuntime = {
	load: () => DOCS_SEARCH_CLIENT,
	reset: () => undefined,
};

const DOCS_READER: DocsReaderPayload = {
	docId: "library-hours",
	elements: [
		{
			anchor: "opening-hours",
			kind: "heading",
			level: 2,
			rootUnitId: "opening-hours-heading",
			text: "开放时间",
		},
		{
			kind: "paragraph",
			rootUnitId: "opening-hours",
			text: "东区图书馆周一至周日开放至 22:00，节假日安排以当日通知为准。",
		},
		{
			anchor: "service-desk",
			kind: "heading",
			level: 2,
			rootUnitId: "service-desk-heading",
			text: "服务台",
		},
		{
			kind: "table",
			rootUnitId: "service-desk",
			rows: [
				[
					{ header: true, text: "区域" },
					{ header: true, text: "开放时间" },
				],
				[
					{ header: false, text: "借阅服务台" },
					{ header: false, text: "08:00-21:30" },
				],
			],
		},
	],
	schemaVersion: "campus_docs_reader.v3",
	supplements: [],
	versionId: "library-hours-v1",
};

const DOCS_DIRECTORY: DocsDirectoryRouteData = {
	kind: "directory",
	siteIndex: DOCS_SITE_INDEX,
};

const DOCS_DOCUMENT: DocsDocumentRouteData = {
	canonicalUrl: "/docs/regulations/student-rules/library-hours",
	collection: "student-rules",
	collectionLabel: "学生服务",
	corpus: "regulations",
	courseMaps: [],
	description: "图书馆开放时间",
	docId: "library-hours",
	documentSlug: "library-hours",
	kind: "document",
	reader: DOCS_READER,
	readerUrl: "/docs-content/library-hours.json",
	routeSlug: "library-hours",
	siteIndex: DOCS_SITE_INDEX,
	title: "图书馆开放时间",
	topicId: "campus-services",
	topicLabel: "校园服务",
	versionSlug: "2026",
	versions: [
		{
			canonicalUrl: "/docs/regulations/student-rules/library-hours",
			versionSlug: "2026",
		},
	],
};

function SearchExample({ query = "" }: { query?: string }) {
	return (
		<StyleDevRouter>
			<div className="style-dev-docs-search-example">
				<DocsSearchPanel
					initialQuery={query}
					onNavigate={() => undefined}
					searchIndexUrl={DOCS_SITE_INDEX.searchIndexUrl}
					searchRuntime={DOCS_SEARCH_RUNTIME}
					siteIndex={DOCS_SITE_INDEX}
				/>
			</div>
		</StyleDevRouter>
	);
}

function DocsRouteExample({ kind }: { kind: "article" | "directory" }) {
	return (
		<StyleDevRouter>
			<div className="style-dev-docs-page-example">
				<DocsPage
					data={kind === "directory" ? DOCS_DIRECTORY : DOCS_DOCUMENT}
					renderMetadata={false}
				/>
			</div>
		</StyleDevRouter>
	);
}

export const DOCS_ENTRIES: readonly StyleDevStory[] = [
	{
		defaultVariant: "idle",
		variants: [
			{ id: "idle", label: "待搜索", render: () => <SearchExample /> },
			{ id: "results", label: "搜索结果", render: () => <SearchExample query="图书馆" /> },
		],
		group: "文档",
		id: "style-dev-docs-search",
		title: "文档搜索",
	},
	{
		defaultVariant: "article",
		variants: [
			{ id: "directory", label: "目录", render: () => <DocsRouteExample kind="directory" /> },
			{
				id: "article",
				label: "正文",
				render: () => <DocsRouteExample kind="article" />,
			},
		],
		group: "文档",
		id: "style-dev-docs-page",
		title: "文档页面",
	},
];
