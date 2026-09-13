import { type CampusPageMetadata, resolveCampusCanonicalUrl } from "./page-metadata";

export function CampusPageMetadataHead({ metadata }: { metadata: CampusPageMetadata }) {
	const canonicalUrl = resolveCampusCanonicalUrl(metadata.canonicalPath);
	return (
		<>
			<title>{metadata.title}</title>
			<meta content={metadata.description} name="description" />
			<meta content={metadata.robots} name="robots" />
			{canonicalUrl ? <link href={canonicalUrl} rel="canonical" /> : null}
		</>
	);
}
