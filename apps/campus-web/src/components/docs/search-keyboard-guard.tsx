import { useEffect } from "react";

const SEARCH_INPUT_ID = "campus-docs-search-input";
const SEARCH_INPUT_NAME = "campus-docs-search";
const SEARCH_INPUT_LABEL = "搜索文档";
const SEARCH_INPUT_SELECTOR = ".rp-search-panel__input,[aria-label='SearchPanelInput']";
const SEARCH_RESULT_LINK_SELECTOR =
	".rp-search-panel__modal .rp-suggest-item--current .rp-suggest-item__link, .rp-search-panel__modal .rp-suggest-item__link";

function isSearchInput(element: EventTarget | null): element is HTMLInputElement {
	return element instanceof HTMLInputElement && element.matches(SEARCH_INPUT_SELECTOR);
}

function isVisibleElement(element: HTMLElement): boolean {
	return element.getClientRects().length > 0;
}

function findSearchResultLink(): HTMLAnchorElement | null {
	const links = document.querySelectorAll<HTMLAnchorElement>(SEARCH_RESULT_LINK_SELECTOR);
	for (const link of links) {
		if (isVisibleElement(link)) {
			return link;
		}
	}
	return null;
}

export function normalizeSearchInputAccessibility(input: HTMLInputElement, index = 0): void {
	const inputId = index === 0 ? SEARCH_INPUT_ID : `${SEARCH_INPUT_ID}-${index + 1}`;
	if (input.id !== inputId) {
		input.id = inputId;
	}
	if (input.name !== SEARCH_INPUT_NAME) {
		input.name = SEARCH_INPUT_NAME;
	}
	if (input.getAttribute("name") !== SEARCH_INPUT_NAME) {
		input.setAttribute("name", SEARCH_INPUT_NAME);
	}
	if (input.getAttribute("aria-label") !== SEARCH_INPUT_LABEL) {
		input.setAttribute("aria-label", SEARCH_INPUT_LABEL);
	}
	if (input.autocomplete !== "off") {
		input.autocomplete = "off";
	}
	if (input.getAttribute("autocomplete") !== "off") {
		input.setAttribute("autocomplete", "off");
	}
}

function enhanceSearchInputAccessibility(root: ParentNode = document): void {
	const inputs = Array.from(root.querySelectorAll<HTMLInputElement>(SEARCH_INPUT_SELECTOR));
	for (const [index, input] of inputs.entries()) {
		normalizeSearchInputAccessibility(input, index);
	}
}

export default function SearchKeyboardGuard(): null {
	useEffect(() => {
		let frame = window.requestAnimationFrame(() => enhanceSearchInputAccessibility());
		const scheduleEnhancement = () => {
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(() => enhanceSearchInputAccessibility());
		};
		const observer = new MutationObserver(scheduleEnhancement);
		observer.observe(document.body, {
			attributeFilter: ["aria-hidden", "class", "hidden", "style"],
			attributes: true,
			childList: true,
			subtree: true,
		});
		const handleFocusIn = (event: FocusEvent) => {
			if (isSearchInput(event.target)) {
				normalizeSearchInputAccessibility(event.target);
			}
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Enter" || event.isComposing || !isSearchInput(document.activeElement)) {
				return;
			}

			const link = findSearchResultLink();
			event.preventDefault();
			event.stopImmediatePropagation();

			link?.click();
		};

		document.addEventListener("focusin", handleFocusIn, { capture: true });
		document.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.cancelAnimationFrame(frame);
			observer.disconnect();
			document.removeEventListener("focusin", handleFocusIn, { capture: true });
			document.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, []);

	return null;
}
