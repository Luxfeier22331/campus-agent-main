import type { CampusPageMetadata } from "./page-metadata";

export function CampusPageMetadataHead({ metadata }: { metadata: CampusPageMetadata }) {
	return (
		<>
			<title>{metadata.title}</title>
			<meta content={metadata.description} name="description" />
			<meta content={metadata.robots} name="robots" />
			{metadata.canonicalPath ? <link href={metadata.canonicalPath} rel="canonical" /> : null}
		</>
	);
}
