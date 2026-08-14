import { render, screen } from "@testing-library/react";
import { NOTICE_DOMAIN_LABELS, NOTICE_DOMAINS, type NoticeDomain } from "campus-contracts/notices";
import { describe, expect, it } from "vitest";
import { NOTICE_DOMAIN_TONES, NoticeDomainBadge } from "../src/features/notices/domain-badge";

const EXPECTED_TONES = {
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
} as const satisfies Record<NoticeDomain, string>;

describe("notice domain badge", () => {
	it("assigns every notice domain to its stable color group", () => {
		expect(NOTICE_DOMAIN_TONES).toEqual(EXPECTED_TONES);
		expect(Object.keys(NOTICE_DOMAIN_TONES)).toHaveLength(NOTICE_DOMAINS.length);
	});

	it.each(NOTICE_DOMAINS)("renders the label and color group for %s", (domain) => {
		render(<NoticeDomainBadge domain={domain} />);

		const badge = screen.getByText(NOTICE_DOMAIN_LABELS[domain]).closest('[data-slot="badge"]');
		expect(badge).toHaveAttribute("data-notice-domain", domain);
		expect(badge).toHaveAttribute("data-notice-domain-tone", EXPECTED_TONES[domain]);
	});

	it("visually separates campus news from procurement", () => {
		const { rerender } = render(<NoticeDomainBadge domain="campus_news" />);
		expect(screen.getByText("校园新闻").closest('[data-slot="badge"]')).toHaveAttribute(
			"data-notice-domain-tone",
			"rose",
		);

		rerender(<NoticeDomainBadge domain="procurement" />);
		expect(screen.getByText("采购").closest('[data-slot="badge"]')).toHaveAttribute(
			"data-notice-domain-tone",
			"orange",
		);
	});
});
