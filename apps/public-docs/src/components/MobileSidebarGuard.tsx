import { useEffect } from "react";

const SIDEBAR_OPEN_SELECTOR = ".rp-doc-layout__sidebar--open";
const SIDEBAR_MASK_SELECTOR = ".rp-sidebar-menu__mask";
const SIDEBAR_MENU_BUTTON_SELECTOR = ".rp-sidebar-menu__left";

function isSidebarOpen(): boolean {
	return document.querySelector(SIDEBAR_OPEN_SELECTOR) !== null;
}

function clickSidebarMask(): boolean {
	const mask = document.querySelector<HTMLElement>(SIDEBAR_MASK_SELECTOR);
	if (!mask) {
		return false;
	}

	mask.click();
	return true;
}

function targetIsInside(target: EventTarget | null, selector: string): boolean {
	return target instanceof Element && target.closest(selector) !== null;
}

export default function MobileSidebarGuard(): null {
	useEffect(() => {
		const handleClick = (event: MouseEvent) => {
			if (!(isSidebarOpen() && targetIsInside(event.target, SIDEBAR_MENU_BUTTON_SELECTOR))) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			clickSidebarMask();
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !isSidebarOpen() || !clickSidebarMask()) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
		};

		document.addEventListener("click", handleClick, { capture: true });
		document.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			document.removeEventListener("click", handleClick, { capture: true });
			document.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, []);

	return null;
}
