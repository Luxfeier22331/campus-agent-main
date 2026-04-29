import { useEffect } from "react";
import { buildVersionReaderHref, parseReaderLocationState } from "../reader/reader-state-core";

interface DocsVersionsResponse {
	versions: Array<{
		isCurrent: boolean;
		label: string;
		versionSlug: string;
	}>;
}

const META_SELECTOR = '.document-meta-panel[data-docs-reader-meta="true"]';
const VERSION_CONTROL_ATTRIBUTE = "data-docs-version-control";
const HIGHLIGHT_CLASS = "docs-reader-highlight";

function enhanceHighlights(): void {
	const state = parseReaderLocationState(window.location.href);
	document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((element) => {
		element.classList.remove(HIGHLIGHT_CLASS);
	});
	for (const rootUnitId of state.highlightRootUnitIds) {
		const escaped = window.CSS?.escape?.(rootUnitId) ?? rootUnitId.replace(/"/g, '\\"');
		document
			.querySelectorAll<HTMLElement>(`[data-root-unit-id="${escaped}"]`)
			.forEach((element) => {
				element.classList.add(HIGHLIGHT_CLASS);
			});
	}
	if (state.anchor) {
		document.getElementById(state.anchor)?.scrollIntoView({ block: "start" });
	}
}

async function enhanceVersionControls(): Promise<void> {
	const panel = document.querySelector<HTMLElement>(META_SELECTOR);
	if (!panel || panel.getAttribute(VERSION_CONTROL_ATTRIBUTE) === "true") {
		return;
	}
	panel.setAttribute(VERSION_CONTROL_ATTRIBUTE, "true");
	const { docsCollection, docsCorpus, docsDocumentSlug, docsVersionSlug } = panel.dataset;
	if (!(docsCollection && docsCorpus && docsDocumentSlug && docsVersionSlug)) {
		return;
	}

	const response = await fetch(
		`/api/docs/collections/${encodeURIComponent(docsCorpus)}/${encodeURIComponent(docsCollection)}/documents/${encodeURIComponent(docsDocumentSlug)}/versions`,
		{ headers: { accept: "application/json" } },
	).catch(() => null);
	if (!response?.ok) {
		return;
	}
	const payload = (await response.json().catch(() => null)) as DocsVersionsResponse | null;
	if (!payload || payload.versions.length <= 1) {
		return;
	}

	const state = parseReaderLocationState(window.location.href);
	const nav = document.createElement("nav");
	nav.className = "docs-version-switcher";
	nav.setAttribute("aria-label", "文档版本");

	const label = document.createElement("span");
	label.className = "docs-version-switcher-label";
	label.textContent = "版本";
	nav.append(label);

	for (const version of payload.versions) {
		const isActive = version.versionSlug === docsVersionSlug;
		const item = document.createElement(isActive ? "span" : "a");
		item.className = "docs-version-switcher-item";
		item.textContent = version.label;
		if (isActive) {
			item.setAttribute("aria-current", "page");
		} else if (item instanceof HTMLAnchorElement) {
			item.href = buildVersionReaderHref({
				collection: docsCollection,
				corpus: docsCorpus,
				documentSlug: docsDocumentSlug,
				isCurrent: version.isCurrent,
				readerState: state,
				versionSlug: version.versionSlug,
			});
		}
		nav.append(item);
	}

	const details = panel.querySelector(".document-meta-details");
	panel.insertBefore(nav, details);
}

export default function ReaderStateEnhancer(): null {
	useEffect(() => {
		const run = () => {
			enhanceHighlights();
			void enhanceVersionControls();
		};
		let frame = window.requestAnimationFrame(run);
		const handleHashChange = () => {
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(run);
		};
		window.addEventListener("hashchange", handleHashChange);
		return () => {
			window.cancelAnimationFrame(frame);
			window.removeEventListener("hashchange", handleHashChange);
		};
	}, []);

	return null;
}
