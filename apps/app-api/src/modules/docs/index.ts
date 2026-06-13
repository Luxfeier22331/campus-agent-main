import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";

export {
	buildDocsService,
	type DocsCollectionRecord,
	type DocsDocumentVersionRecord,
	type DocsReaderAssetRecord,
	type DocsReadModelStore,
	type DocsVersionAccessRecord,
} from "./service";
export { createPgDocsReadModelStore } from "./store";

export type ReaderAssetDeliveryMode = "public_static_asset" | "gated_asset";

export interface DocsNavigationResponse {
	collection: {
		collection: string;
		corpus: string;
		description?: string;
		displayName: string;
	};
	nodes: Array<{
		canonicalUrl: string;
		documentSlug: string;
		displayTitle: string;
		isCurrent: boolean;
		kind: "document" | "section";
		title: string;
	}>;
}

export interface DocsDocumentSummaryResponse {
	document: {
		canonicalUrl: string;
		collection: string;
		corpus: string;
		currentVersionId: string;
		currentVersionSlug: string;
		docId: string;
		documentSlug: string;
		title: string;
		updatedAt: string;
	};
}

export interface DocsVersionsResponse {
	document: {
		docId: string;
		documentSlug: string;
		title: string;
	};
	versions: Array<{
		effectiveFrom: string | null;
		isCurrent: boolean;
		label: string;
		versionId: string;
		versionSlug: string;
	}>;
}

export interface DocsResolveResponse {
	document: {
		canonicalUrl: string;
		collection: string;
		corpus: string;
		docId: string;
		documentSlug: string;
		title: string;
		updatedAt: string;
		versionId: string;
		versionSlug: string;
	};
	readerAsset: {
		canonicalUrl: string;
		contentUrl: string;
		deliveryMode: ReaderAssetDeliveryMode;
		outlineUrl: string;
	};
	readerState: {
		anchor: string | null;
		highlightRootUnitIds: string[];
	};
	resolvedVersion: {
		isCurrent: boolean;
		label: string;
		versionId: string;
		versionSlug: string;
	};
}

export interface DocsService {
	getDocumentSummary(input: {
		collection: string;
		corpus: string;
		documentSlug: string;
		principal: ResolvedAppPrincipal | null;
	}): Promise<DocsDocumentSummaryResponse>;
	getNavigation(input: {
		collection: string;
		corpus: string;
		principal: ResolvedAppPrincipal | null;
	}): Promise<DocsNavigationResponse>;
	getVersions(input: {
		collection: string;
		corpus: string;
		documentSlug: string;
		principal: ResolvedAppPrincipal | null;
	}): Promise<DocsVersionsResponse>;
	resolveReader(input: {
		anchor: string | null;
		collection: string;
		corpus: string;
		documentSlug: string;
		highlightRootUnitIds: string[];
		principal: ResolvedAppPrincipal | null;
		version: string | null;
	}): Promise<DocsResolveResponse>;
	checkReaderAdmission(input: {
		collection: string;
		corpus: string;
		documentSlug: string;
		principal: ResolvedAppPrincipal | null;
		version: string | null;
	}): Promise<void>;
}

export function buildUnavailableDocsService(): DocsService {
	const unavailable = () => {
		throw new AppApiRouteError({
			code: "docs_not_configured",
			message: "Document reader control plane is not configured.",
			retryable: false,
			status: 503,
		});
	};

	return {
		getDocumentSummary: unavailable,
		getNavigation: unavailable,
		getVersions: unavailable,
		resolveReader: unavailable,
		checkReaderAdmission: unavailable,
	};
}
