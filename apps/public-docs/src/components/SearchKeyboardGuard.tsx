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

export default function SearchKeyboardGuard(): null {
	useEffect(() => {
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
			document.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, []);

	return null;
}
