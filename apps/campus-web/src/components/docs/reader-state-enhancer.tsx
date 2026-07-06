import { useEffect } from "react";

import {
	type DocsVersionsResponse,
	fetchDocsVersionControlPayload,
	readStaticDocsVersionPayload,
} from "@/docs/reader/reader-version-controls";
import { buildVersionReaderHref, parseReaderLocationState } from "@/features/docs/reader-state";

const META_SELECTOR = '.document-meta-panel[data-docs-reader-meta="true"]';
const READER_ROOT_SELECTOR = ".rspress-doc";
const READER_CLONED_NAV_COPY_ACTION_SELECTOR =
	".rp-doc-layout__outline .docs-reader-heading-actions, .rp-doc-layout__sidebar .docs-reader-heading-actions, .rp-doc-outline .docs-reader-heading-actions";
const READER_NAV_LINK_SELECTOR =
	'.rp-doc-outline a[href^="#"], .rp-doc-layout__sidebar a[href^="#"], .rspress-doc nav a[href^="#"]';
const VERSION_CONTROL_ATTRIBUTE = "data-docs-version-control";
const VERSION_HISTORY_WARNING_ATTRIBUTE = "data-docs-version-history-warning";
const COPY_LINK_ATTRIBUTE = "data-docs-copy-link-enhanced";
const HIGHLIGHT_CLASS = "docs-reader-highlight";
const CURRENT_LINK_CLASS = "docs-reader-current-link";
const COPY_LINK_COPIED_TEXT = "已复制链接";
const COPY_LINK_FAILED_TEXT = "无法复制链接";
const COPY_LINK_RESET_MS = 3000;

interface ReaderPermalinkTarget {
	anchor: string;
	heading: HTMLHeadingElement;
	rootUnitId: string | null;
	title: string;
}

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
		focusReaderTarget(document.getElementById(state.anchor));
	}
	markCurrentReaderNavigationLink(state.anchor);
}

function focusReaderTarget(target: HTMLElement | null): void {
	if (!target) {
		return;
	}
	if (!target.hasAttribute("tabindex")) {
		target.tabIndex = -1;
	}
	target.scrollIntoView({ block: "start" });
	target.focus({ preventScroll: true });
}

function markCurrentReaderNavigationLink(anchor: string | null): void {
	for (const link of Array.from(
		document.querySelectorAll<HTMLAnchorElement>(READER_NAV_LINK_SELECTOR),
	)) {
		const linkAnchor = readHashAnchor(link);
		const isCurrent = Boolean(anchor && linkAnchor === anchor);
		link.classList.toggle(CURRENT_LINK_CLASS, isCurrent);
		if (isCurrent) {
			link.setAttribute("aria-current", "location");
		} else if (link.getAttribute("aria-current") === "location") {
			link.removeAttribute("aria-current");
		}
	}
}

function readHashAnchor(link: HTMLAnchorElement): string | null {
	const href = link.getAttribute("href");
	if (!href?.startsWith("#") || href.length <= 1) {
		return null;
	}
	try {
		return decodeURIComponent(href.slice(1));
	} catch {
		return href.slice(1);
	}
}

function enhanceReaderPermalinks(): void {
	const readerRoot = document.querySelector<HTMLElement>(READER_ROOT_SELECTOR);
	if (!readerRoot) {
		return;
	}
	removeClonedNavigationCopyActions();
	for (const target of collectReaderPermalinkTargets(readerRoot)) {
		if (target.heading.getAttribute(COPY_LINK_ATTRIBUTE) === "true") {
			continue;
		}
		target.heading.setAttribute(COPY_LINK_ATTRIBUTE, "true");
		target.heading.appendChild(renderCopyLinkAction(target));
	}
}

function removeClonedNavigationCopyActions(): void {
	document.querySelectorAll(READER_CLONED_NAV_COPY_ACTION_SELECTOR).forEach((element) => {
		element.remove();
	});
}

function collectReaderPermalinkTargets(readerRoot: Document | Element): ReaderPermalinkTarget[] {
	const targets: ReaderPermalinkTarget[] = [];
	const seenAnchors = new Set<string>();
	const seenHeadings = new WeakSet<HTMLHeadingElement>();
	for (const anchorElement of Array.from(
		readerRoot.querySelectorAll<HTMLElement>(
			'span[id], h1[id], h2[id], h3[id], h4[id], h5[id], h6[id], a.rp-header-anchor[href^="#"], a.header-anchor[href^="#"]',
		),
	)) {
		const anchor = readAnchorElementId(anchorElement);
		if (!anchor || seenAnchors.has(anchor)) {
			continue;
		}
		const heading = findHeadingForAnchorElement(anchorElement);
		if (!heading) {
			continue;
		}
		if (seenHeadings.has(heading)) {
			continue;
		}
		const title = readHeadingTitle(heading);
		if (!title) {
			continue;
		}
		seenAnchors.add(anchor);
		seenHeadings.add(heading);
		targets.push({
			anchor,
			heading,
			rootUnitId: findRootUnitIdForHeading(heading),
			title,
		});
	}
	return targets;
}

function readHeadingTitle(heading: HTMLHeadingElement): string {
	const clone = heading.cloneNode(true);
	if (!(clone instanceof HTMLElement)) {
		return normalizeReaderText(heading.textContent);
	}
	clone
		.querySelectorAll(".docs-reader-heading-actions, .rp-header-anchor, .header-anchor")
		.forEach((element) => {
			element.remove();
		});
	return normalizeReaderText(clone.textContent);
}

function readAnchorElementId(element: HTMLElement): string | null {
	if (element instanceof HTMLAnchorElement) {
		return readHashAnchor(element);
	}
	return element.id || null;
}

function findHeadingForAnchorElement(element: HTMLElement): HTMLHeadingElement | null {
	if (isHeadingElement(element)) {
		return element;
	}
	const parentHeading = element.closest<HTMLHeadingElement>("h1,h2,h3,h4,h5,h6");
	if (parentHeading) {
		return parentHeading;
	}
	let nextElement = element.nextElementSibling;
	while (nextElement) {
		if (isHeadingElement(nextElement)) {
			return nextElement;
		}
		if (nextElement.matches("[data-root-unit-id]")) {
			return null;
		}
		nextElement = nextElement.nextElementSibling;
	}
	return element.closest("section")?.querySelector<HTMLHeadingElement>("h1,h2,h3,h4,h5,h6") ?? null;
}

function findRootUnitIdForHeading(heading: HTMLHeadingElement): string | null {
	const sectionRootUnitId = heading
		.closest("section")
		?.querySelector<HTMLElement>("[data-root-unit-id]")?.dataset.rootUnitId;
	if (sectionRootUnitId) {
		return sectionRootUnitId;
	}
	let nextElement = heading.nextElementSibling;
	while (nextElement) {
		if (isHeadingElement(nextElement)) {
			return null;
		}
		if (nextElement instanceof HTMLElement) {
			const rootUnitId =
				nextElement.dataset.rootUnitId ??
				nextElement.querySelector<HTMLElement>("[data-root-unit-id]")?.dataset.rootUnitId;
			if (rootUnitId) {
				return rootUnitId;
			}
		}
		nextElement = nextElement.nextElementSibling;
	}
	return null;
}

function renderCopyLinkAction(target: ReaderPermalinkTarget): HTMLElement {
	const action = document.createElement("span");
	action.className = "docs-reader-heading-actions";
	action.dataset.docsCopyLinkFor = target.anchor;

	const button = document.createElement("button");
	button.className = "docs-reader-copy-link-button";
	button.type = "button";
	button.textContent = "#";
	button.setAttribute("aria-label", `复制“${target.title}”链接`);

	const status = document.createElement("span");
	status.className = "docs-reader-copy-link-status";
	status.setAttribute("aria-live", "polite");

	button.addEventListener("click", () => {
		void copyReaderPermalink(target, status);
	});

	action.appendChild(button);
	action.appendChild(status);
	return action;
}

async function copyReaderPermalink(
	target: ReaderPermalinkTarget,
	status: HTMLElement,
): Promise<void> {
	const clipboard = navigator.clipboard;
	if (!clipboard) {
		renderCopyLinkStatus(status, COPY_LINK_FAILED_TEXT);
		return;
	}
	try {
		await clipboard.writeText(buildReaderPermalink(target));
		renderCopyLinkStatus(status, COPY_LINK_COPIED_TEXT);
	} catch {
		renderCopyLinkStatus(status, COPY_LINK_FAILED_TEXT);
	}
}

function buildReaderPermalink(target: ReaderPermalinkTarget): string {
	const url = new URL(window.location.href);
	url.search = "";
	url.hash = "";
	if (target.rootUnitId) {
		url.searchParams.set("hl", target.rootUnitId);
	}
	url.hash = target.anchor;
	return url.toString();
}

function renderCopyLinkStatus(status: HTMLElement, message: string): void {
	status.textContent = message;
	status.setAttribute("role", "status");
	window.setTimeout(() => {
		if (status.textContent === message) {
			status.textContent = "";
			status.removeAttribute("role");
		}
	}, COPY_LINK_RESET_MS);
}

function isHeadingElement(element: Element): element is HTMLHeadingElement {
	return /^H[1-6]$/.test(element.tagName);
}

function normalizeReaderText(value: string | null | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

async function enhanceVersionControls(): Promise<void> {
	const panel = document.querySelector<HTMLElement>(META_SELECTOR);
	if (!panel || panel.getAttribute(VERSION_CONTROL_ATTRIBUTE) === "true") {
		return;
	}
	panel.setAttribute(VERSION_CONTROL_ATTRIBUTE, "true");
	renderVersionHistoryWarning(panel);
	const { docsCollection, docsCorpus, docsDocumentSlug, docsRouteSlug, docsVersionSlug } =
		panel.dataset;
	if (!(docsCollection && docsCorpus && docsDocumentSlug && docsRouteSlug && docsVersionSlug)) {
		return;
	}

	const staticPayload = readStaticDocsVersionPayload(panel);
	let payload: DocsVersionsResponse;
	if (staticPayload) {
		payload = staticPayload;
	} else {
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
				routeSlug: docsRouteSlug,
				versionSlug: version.versionSlug,
			});
		}
		nav.appendChild(item);
	}

	const details = panel.querySelector(".document-meta-details");
	panel.insertBefore(nav, details);
}

function renderVersionHistoryWarning(panel: HTMLElement): void {
	if (
		panel.dataset.docsIsCurrent !== "false" ||
		panel.getAttribute(VERSION_HISTORY_WARNING_ATTRIBUTE) === "true"
	) {
		return;
	}
	panel.setAttribute(VERSION_HISTORY_WARNING_ATTRIBUTE, "true");
	const warning = document.createElement("p");
	warning.className = "docs-reader-status docs-version-history-warning";
	warning.setAttribute("role", "status");
	warning.textContent = "正在阅读历史版本，请以当前版为准。";
	const details = panel.querySelector(".document-meta-details");
	panel.insertBefore(warning, details);
}

function renderVersionControlError(panel: HTMLElement): void {
	const status = document.createElement("p");
	status.className = "docs-reader-status docs-version-switcher-error";
	status.setAttribute("role", "status");
	status.textContent = "文档版本信息暂不可用。";
	const details = panel.querySelector(".document-meta-details");
	panel.insertBefore(status, details);
}

export default function ReaderStateEnhancer(): null {
	useEffect(() => {
		const run = () => {
			enhanceReaderState();
			enhanceReaderPermalinks();
			void enhanceVersionControls();
		};
		let frame = 0;
		const scheduleRun = () => {
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(run);
		};
		scheduleRun();
		const observer = new MutationObserver(scheduleRun);
		observer.observe(document.body, { childList: true, subtree: true });
		window.addEventListener("hashchange", scheduleRun);
		window.addEventListener("popstate", scheduleRun);
		return () => {
			window.cancelAnimationFrame(frame);
			observer.disconnect();
			window.removeEventListener("hashchange", scheduleRun);
			window.removeEventListener("popstate", scheduleRun);
		};
	}, []);

	return null;
}
