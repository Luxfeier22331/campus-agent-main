import { Badge, cn } from "@campus-agent/ui";
import { NOTICE_DOMAIN_LABELS, type NoticeDomain } from "campus-contracts/notices";

export const NOTICE_DOMAIN_TONES = {
	academic_achievement: "blue",
	academic_information: "blue",
	admissions: "green",
	campus_news: "rose",
	campus_operations: "orange",
	culture_sports: "rose",
	discipline_competition: "blue",
	employment: "green",
	external_cooperation: "teal",
	governance: "slate",
	human_resources: "slate",
	international_programs: "teal",
	procurement: "orange",
	student_development: "green",
	student_support: "green",
	teaching_affairs: "blue",
	unclassified: "warning",
} as const satisfies Record<NoticeDomain, NoticeDomainTone>;

export type NoticeDomainTone = "blue" | "green" | "orange" | "rose" | "slate" | "teal" | "warning";

export function NoticeDomainBadge({
	className,
	domain,
}: {
	className?: string;
	domain: NoticeDomain;
}) {
	return (
		<Badge
			className={cn("notice-domain-badge max-w-full shrink-0 overflow-hidden px-2", className)}
			data-notice-domain={domain}
			data-notice-domain-tone={NOTICE_DOMAIN_TONES[domain]}
		>
			<span className="truncate">{NOTICE_DOMAIN_LABELS[domain]}</span>
		</Badge>
	);
}
