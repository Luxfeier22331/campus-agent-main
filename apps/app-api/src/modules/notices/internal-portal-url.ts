import descriptor from "../../../../../configs/sources/internal-portal.json";

export function buildInternalPortalAttachmentUrl(input: {
	noticeId: string;
	portalAnnexId: string;
}): string {
	const url = new URL("/comsys-portal-notice-web/download", descriptor.portal_base_url);
	url.search = new URLSearchParams({
		id: input.portalAnnexId,
		notice_id: input.noticeId,
	}).toString();
	return url.toString();
}
