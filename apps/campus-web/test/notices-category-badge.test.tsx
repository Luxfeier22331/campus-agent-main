import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { NOTICE_CATEGORIES, NOTICE_CATEGORY_LABELS } from "campus-contracts/notices";
import { describe, expect, it } from "vitest";
import { NOTICE_CATEGORY_TONES, NoticeCategoryBadge } from "../src/features/notices/category-badge";

const EXPECTED_TONES = {
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
} as const;
const CAMPUS_STYLES = readFileSync("src/campus-styles.css", "utf8");

describe("notice category badge", () => {
	it("assigns every category to a stable color group", () => {
		expect(NOTICE_CATEGORY_TONES).toEqual(EXPECTED_TONES);
		expect(Object.keys(NOTICE_CATEGORY_TONES)).toHaveLength(NOTICE_CATEGORIES.length - 1);
	});

	it("has a style selector for every visible tone", () => {
		for (const tone of new Set(Object.values(EXPECTED_TONES))) {
			expect(CAMPUS_STYLES).toContain(
				`.notice-category-badge[data-notice-category-tone="${tone}"]`,
			);
		}
	});

	it.each(NOTICE_CATEGORIES.filter((category) => category !== "unclassified"))(
		"renders the label and color group for %s",
		(category) => {
			render(<NoticeCategoryBadge category={category} />);

			const badge = screen
				.getByText(NOTICE_CATEGORY_LABELS[category])
				.closest('[data-slot="badge"]');
			expect(badge).toHaveAttribute("data-notice-category", category);
			expect(badge).toHaveAttribute("data-notice-category-tone", EXPECTED_TONES[category]);
		},
	);

	it("does not expose an unclassified badge", () => {
		const { container } = render(<NoticeCategoryBadge category="unclassified" />);
		expect(container).toBeEmptyDOMElement();
	});
});
