import { useEffect } from "react";

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

function enhanceSearchInputAccessibility(root: ParentNode = document): void {
	for (const input of Array.from(root.querySelectorAll<HTMLInputElement>(SEARCH_INPUT_SELECTOR))) {
		if (input.id !== "public-docs-search-input") {
			input.id = "public-docs-search-input";
		}
		if (input.name !== "public-docs-search") {
			input.name = "public-docs-search";
		}
		if (input.getAttribute("aria-label") !== "搜索公开文档") {
			input.setAttribute("aria-label", "搜索公开文档");
		}
		if (!input.autocomplete) {
			input.autocomplete = "off";
		}
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
		observer.observe(document.body, { childList: true, subtree: true });
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Enter" || event.isComposing || !isSearchInput(document.activeElement)) {
				return;
			}

			const link = findSearchResultLink();
			event.preventDefault();
			event.stopImmediatePropagation();

			if (link) {
				link.click();
			}
		};

		document.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.cancelAnimationFrame(frame);
			observer.disconnect();
			document.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, []);

	return null;
}
