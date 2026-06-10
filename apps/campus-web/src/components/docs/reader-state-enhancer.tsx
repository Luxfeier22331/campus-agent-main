import { useEffect } from "react";

import { parseReaderLocationState } from "@/features/docs/reader-state";

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

export default function ReaderStateEnhancer(): null {
	useEffect(() => {
		const run = () => enhanceReaderState();
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
