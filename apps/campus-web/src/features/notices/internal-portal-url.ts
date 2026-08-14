import internalPortalDescriptor from "../../../../../configs/sources/internal-portal.json";

export function buildInternalPortalNoticeUrl(input: {
	noticeId: string;
	noticeType: number;
}): string {
	const url = new URL(internalPortalDescriptor.portal_page_url);
	const search = new URLSearchParams({
		notice_id: input.noticeId,
		show_type: "1",
		type: String(input.noticeType),
	});
	url.hash = `/print?${search.toString()}`;
	return url.toString();
}
