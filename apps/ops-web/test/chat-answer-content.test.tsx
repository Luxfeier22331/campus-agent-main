import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatAnswerBody, resolveAnswerLink } from "../src/app/chat-answer-content";

const noticeSource = {
	kind: "campus_notice" as const,
	citationIndexes: [1],
	noticeId: "354516",
	title: "测试通知",
	sectionTitle: "正文",
	snippet: null,
	primaryAction: {
		href: "https://campus.example.test/notices/354516",
		label: "查看通知" as const,
		external: false as const,
		disabledReason: null,
	},
};

describe("answer markdown links", () => {
	it("resolves local notice citations through the normalized source action", () => {
		expect(resolveAnswerLink("/notices/354516", [noticeSource])).toBe(
			"https://campus.example.test/notices/354516",
		);
		expect(resolveAnswerLink("/notices/unknown", [noticeSource])).toBeNull();
	});

	it("uses document source destinations including their anchors and preserves external links", () => {
		const path = "/docs/regulations/student_rules/student-rules/v/2026#status";
		const document = {
			...noticeSource,
			kind: "campus_document" as const,
			collectionLabel: "规章",
			versionSlug: "2026",
			primaryAction: {
				...noticeSource.primaryAction,
				label: "查看文档" as const,
				href: `https://campus.example.test${path}`,
			},
		};
		expect(resolveAnswerLink(path, [document])).toBe(`https://campus.example.test${path}`);
		for (const href of [
			"https://example.org/notices/1",
			"https://example.org/docs/page",
			"mailto:test@example.org",
		]) {
			expect(resolveAnswerLink(href, [document])).toBe(href);
		}
	});
	it("keeps disabled or missing sources non-clickable", () => {
		const disabled = {
			...noticeSource,
			primaryAction: {
				...noticeSource.primaryAction,
				href: null,
				disabledReason: "Campus Web 地址未配置。",
			},
		};
		expect(resolveAnswerLink("/notices/354516", [disabled])).toBeNull();
		expect(resolveAnswerLink("/docs/missing", [])).toBeNull();
		expect(resolveAnswerLink("/notices/354516/invalid", [noticeSource])).toBeNull();
	});

	it("renders a resolved notice citation as a link and an unresolved one as text", () => {
		const { rerender } = render(
			<ChatAnswerBody kind="answer" text="[已知通知](/notices/354516)" sources={[noticeSource]} />,
		);
		expect(screen.getByRole("link", { name: "已知通知" })).toHaveAttribute(
			"href",
			"https://campus.example.test/notices/354516",
		);
		rerender(
			<ChatAnswerBody kind="answer" text="[未知通知](/notices/unknown)" sources={[noticeSource]} />,
		);
		expect(screen.queryByRole("link", { name: "未知通知" })).not.toBeInTheDocument();
		expect(screen.getByText("未知通知")).toBeInTheDocument();
	});
});
