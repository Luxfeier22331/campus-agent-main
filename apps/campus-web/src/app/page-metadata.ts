export type CampusRobots = "index,follow" | "noindex,nofollow";

export interface CampusPageMetadata {
	canonicalPath: string | null;
	description: string;
	robots: CampusRobots;
	title: string;
}

export const CAMPUS_PRODUCT_NAME = "中央民族大学校园问答";
const CAMPUS_WEB_CANONICAL_ORIGIN = "https://chat.muc.wiki";

export function resolveCampusCanonicalUrl(canonicalPath: string | null): string | null {
	return canonicalPath === null ? null : new URL(canonicalPath, CAMPUS_WEB_CANONICAL_ORIGIN).href;
}

export function composeCampusPageTitle(title: string): string {
	return `${title} | ${CAMPUS_PRODUCT_NAME}`;
}
