import { Badge, cn } from "@campus-agent/ui";
import { NOTICE_CATEGORY_LABELS, type NoticeCategory } from "campus-contracts/notices";

type VisibleNoticeCategory = Exclude<NoticeCategory, "unclassified">;

export const NOTICE_CATEGORY_TONES = {
	research_affairs: "blue",
	lectures_forums: "teal",
	teaching_affairs: "blue",
	student_affairs: "green",
	competitions: "rose",
	admissions: "green",
	international_programs: "teal",
	employment: "green",
	campus_operations: "orange",
	human_resources: "slate",
	governance: "slate",
	procurement: "orange",
	campus_activities: "rose",
	campus_news: "teal",
} as const satisfies Record<VisibleNoticeCategory, NoticeCategoryTone>;

export type NoticeCategoryTone = "blue" | "green" | "orange" | "rose" | "slate" | "teal";

export function NoticeCategoryBadge({
	category,
	className,
}: {
	category: NoticeCategory;
	className?: string;
}) {
	if (category === "unclassified") {
		return null;
	}
	return (
		<Badge
			className={cn("notice-category-badge max-w-full shrink-0 overflow-hidden px-2", className)}
			data-notice-category={category}
			data-notice-category-tone={NOTICE_CATEGORY_TONES[category]}
		>
			<span className="truncate">{NOTICE_CATEGORY_LABELS[category]}</span>
		</Badge>
	);
}
