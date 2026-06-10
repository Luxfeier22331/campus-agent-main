import { useEffect } from "react";

import {
	type DocsVersionsResponse,
	fetchDocsVersionControlPayload,
} from "@/docs/reader/reader-version-controls";
import { buildVersionReaderHref, parseReaderLocationState } from "@/features/docs/reader-state";

const META_SELECTOR = '.document-meta-panel[data-docs-reader-meta="true"]';
const VERSION_CONTROL_ATTRIBUTE = "data-docs-version-control";
const HIGHLIGHT_CLASS = "docs-reader-highlight";

function enhanceReaderState(): void {
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

	let payload: DocsVersionsResponse;
	try {
		payload = await fetchDocsVersionControlPayload({
			collection: docsCollection,
			corpus: docsCorpus,
			documentSlug: docsDocumentSlug,
		});
	} catch {
		renderVersionControlError(panel);
		return;
	}
	if (payload.versions.length <= 1) {
		return;
	}

	const state = parseReaderLocationState(window.location.href);
	const nav = document.createElement("nav");
	nav.className = "docs-version-switcher";
	nav.setAttribute("aria-label", "文档版本");

	const label = document.createElement("span");
	label.className = "docs-version-switcher-label";
	label.textContent = "版本";
	nav.appendChild(label);

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
		nav.appendChild(item);
	}

	const details = panel.querySelector(".document-meta-details");
	panel.insertBefore(nav, details);
}

function renderVersionControlError(panel: HTMLElement): void {
	const status = document.createElement("p");
	status.className = "docs-version-switcher-error";
	status.setAttribute("role", "status");
	status.textContent = "文档版本信息暂不可用。";
	const details = panel.querySelector(".document-meta-details");
	panel.insertBefore(status, details);
}

export default function ReaderStateEnhancer(): null {
	useEffect(() => {
		const run = () => {
			enhanceReaderState();
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
