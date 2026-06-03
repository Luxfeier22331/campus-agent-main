import type { CheerioCrawlingContext } from "crawlee";
import { analyzeVisibleShellContainers } from "./page-artifacts-shell-detection-containers.ts";

export function looksLikeDynamicShell(responseBody: string): boolean {
	const normalized = responseBody.toLowerCase();
	const scriptCount = (normalized.match(/<script\b/g) ?? []).length;
	const hasMountNode =
		/id=["'](app|root|__next|nuxt)["']/.test(normalized) || /data-v-app/.test(normalized);
	const hasClientFetchSignal =
		/(fetch\(|axios|xmlhttprequest|reactdom|createapp\(|window\.__|jsonp|\.load\()/i.test(
			responseBody,
		);

	return scriptCount >= 1 && (hasMountNode || hasClientFetchSignal);
}

export function looksLikeStructuralShell(html: CheerioCrawlingContext["$"]): boolean {
	const containers = analyzeVisibleShellContainers(html);
	if (containers.length === 0) {
		return false;
	}

	const maxTextLength = containers.reduce((max, item) => Math.max(max, item.textLength), 0);
	const hasStructuredShellCue = containers.some(
		(item) =>
			item.mediaCount > 0 || item.listCount > 0 || item.hasPagination || containers.length >= 2,
	);

	return maxTextLength <= 24 && hasStructuredShellCue;
}
