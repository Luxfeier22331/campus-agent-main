import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

type MetaEntry =
	| string
	| { type: "file"; name: string; label?: string }
	| {
			type: "dir";
			name: string;
			label?: string;
			collapsed?: boolean;
			collapsible?: boolean;
	  }
	| { type: "section-header"; label: string };

interface SidebarItem {
	text: string;
	link: string;
}

interface SidebarGroup {
	text: string;
	link?: string;
	items: SidebarEntry[];
	collapsed?: boolean;
	collapsible?: boolean;
}

interface SidebarSectionHeader {
	sectionHeaderText: string;
}

type SidebarEntry = SidebarGroup | SidebarItem | SidebarSectionHeader;

export interface RspressSidebarConfig {
	[path: string]: SidebarEntry[];
}

const PAGE_EXTENSIONS = [".md", ".mdx"] as const;

export function buildRspressSidebarConfig(docsRoot: string): RspressSidebarConfig {
	return {
		"/": buildSidebarEntries(docsRoot, docsRoot),
	};
}

function buildSidebarEntries(directory: string, docsRoot: string): SidebarEntry[] {
	return readMetaEntries(directory).flatMap((entry) => {
		const sidebarEntry = metaEntryToSidebarEntry(entry, directory, docsRoot);
		return sidebarEntry ? [sidebarEntry] : [];
	});
}

function readMetaEntries(directory: string): MetaEntry[] {
	const metaPath = join(directory, "_meta.json");
	if (!existsSync(metaPath)) {
		return [];
	}
	return JSON.parse(readFileSync(metaPath, "utf8")) as MetaEntry[];
}

function metaEntryToSidebarEntry(
	entry: MetaEntry,
	directory: string,
	docsRoot: string,
): SidebarEntry | null {
	if (typeof entry === "string") {
		return fileMetaEntryToSidebarItem({ type: "file", name: entry }, directory, docsRoot);
	}
	if (entry.type === "file") {
		return fileMetaEntryToSidebarItem(entry, directory, docsRoot);
	}
	if (entry.type === "dir") {
		return dirMetaEntryToSidebarGroup(entry, directory, docsRoot);
	}
	if (entry.type === "section-header") {
		return { sectionHeaderText: entry.label };
	}
	return null;
}

function fileMetaEntryToSidebarItem(
	entry: Extract<MetaEntry, { type: "file" }>,
	directory: string,
	docsRoot: string,
): SidebarItem | null {
	const filePath = resolvePagePath(join(directory, entry.name));
	if (!filePath) {
		return null;
	}
	return {
		text: entry.label ?? readFrontmatterTitle(filePath) ?? basename(entry.name),
		link: pagePathToRoute(filePath, docsRoot),
	};
}

function dirMetaEntryToSidebarGroup(
	entry: Extract<MetaEntry, { type: "dir" }>,
	directory: string,
	docsRoot: string,
): SidebarGroup | null {
	const dirPath = join(directory, entry.name);
	const indexPath = resolvePagePath(join(dirPath, "index"));
	const childEntries = buildSidebarEntries(dirPath, docsRoot).filter(
		(item) => !("link" in item && indexPath && item.link === pagePathToRoute(indexPath, docsRoot)),
	);
	if (childEntries.length === 0 && !indexPath) {
		return null;
	}
	return {
		text: entry.label ?? readFrontmatterTitle(indexPath) ?? entry.name,
		...(indexPath ? { link: pagePathToRoute(indexPath, docsRoot) } : {}),
		collapsed: entry.collapsed ?? false,
		collapsible: entry.collapsible ?? true,
		items: childEntries,
	};
}

function resolvePagePath(pathWithoutExtension: string): string | null {
	for (const extension of PAGE_EXTENSIONS) {
		const path = pathWithoutExtension.endsWith(extension)
			? pathWithoutExtension
			: `${pathWithoutExtension}${extension}`;
		if (existsSync(path)) {
			return path;
		}
	}
	return null;
}

function pagePathToRoute(filePath: string, docsRoot: string): string {
	const relativePath = relative(docsRoot, filePath)
		.replace(/\\/g, "/")
		.replace(/\.(md|mdx)$/u, "");
	if (relativePath === "index") {
		return "/";
	}
	if (relativePath.endsWith("/index")) {
		return `/${dirname(relativePath)}/`;
	}
	return `/${relativePath}`;
}

function readFrontmatterTitle(filePath: string | null): string | null {
	if (!filePath) {
		return null;
	}
	const source = readFileSync(filePath, "utf8");
	const match = source.match(/^---\n(?<frontmatter>[\s\S]*?)\n---/u);
	const title = match?.groups?.frontmatter.match(/^title:\s*"?([^"\n]+)"?\s*$/mu)?.[1];
	return title?.trim() || null;
}
