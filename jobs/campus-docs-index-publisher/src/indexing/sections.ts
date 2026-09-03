import type {
	DocsReader,
	DocsReaderElement,
	DocsSourceManifest,
	DocsSourceVersion,
} from "campus-contracts/campus-docs";
import type { ReaderSection } from "../types.ts";
import { stableId } from "./content-digest.ts";

export function buildSections(
	document: DocsSourceManifest["documents"][number],
	version: DocsSourceVersion,
	reader: DocsReader,
): ReaderSection[] {
	const sections: ReaderSection[] = [];
	let current: MutableSection | undefined;
	const preamble: MutableSection = {
		anchor: null,
		elements: [],
		headingPath: [],
	};
	const headingStack: Array<{ level: number; text: string }> = [];
	for (const element of reader.elements) {
		if (element.kind === "heading") {
			appendSection(sections, current, document, version);
			while ((headingStack.at(-1)?.level ?? 0) >= element.level) headingStack.pop();
			headingStack.push({ level: element.level, text: normalizeBlockText(element.text) });
			current = {
				anchor: element.anchor,
				elements: [],
				headingPath: headingStack.map((heading) => heading.text),
			};
			continue;
		}
		if (!indexableReaderElement(element)) continue;
		if (current) {
			current.elements.push(element);
		} else {
			preamble.elements.push(element);
		}
	}
	appendSection(sections, current, document, version);
	if (preamble.elements.length > 0) sections.unshift(finalizeSection(preamble, document, version));
	if (sections.length === 0) {
		throw new Error(`reader has no indexable content: ${version.versionId}`);
	}
	return sections;
}
export function normalizeBlockText(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

export function isSourceUrlOnly(value: string): boolean {
	return /^>\s*Source URL:\s*https?:\/\/\S+$/u.test(normalizeBlockText(value));
}

export type ReaderContentElement = Exclude<DocsReaderElement, { kind: "heading" }>;

interface MutableSection {
	anchor: string | null;
	elements: ReaderContentElement[];
	headingPath: string[];
}

function appendSection(
	sections: ReaderSection[],
	section: MutableSection | undefined,
	document: DocsSourceManifest["documents"][number],
	version: DocsSourceVersion,
): void {
	if (section && section.elements.length > 0) {
		sections.push(finalizeSection(section, document, version));
	}
}

function finalizeSection(
	section: MutableSection,
	document: DocsSourceManifest["documents"][number],
	version: DocsSourceVersion,
): ReaderSection {
	const sectionTitle = section.headingPath.join(" > ") || document.title;
	return {
		anchor: section.anchor,
		elements: [...section.elements],
		headingPath: [...section.headingPath],
		sectionId: stableId("section", [
			document.docId,
			version.versionId,
			section.anchor ?? "",
			...section.headingPath,
		]),
		sectionTitle,
	};
}

function indexableReaderElement(element: ReaderContentElement): boolean {
	if (element.kind !== "table") {
		const content = normalizeBlockText(element.text);
		return content !== "" && !isSourceUrlOnly(content);
	}
	return element.rows.some((row) => row.some((cell) => normalizeBlockText(cell.text) !== ""));
}
