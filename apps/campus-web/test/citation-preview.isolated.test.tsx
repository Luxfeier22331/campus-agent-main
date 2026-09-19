import {
	AssistantRuntimeProvider,
	MessagePrimitive,
	ThreadPrimitive,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "../src/components/assistant-ui/markdown-text";
import { CitationSourcesContext } from "../src/components/conversation/citation-preview";
import type { SourceItemPayload } from "../src/features/conversation/model";

const source: SourceItemPayload = {
	kind: "web_page",
	citationIndexes: [1, 5],
	title: "民大境外访学项目",
	hostname: "cie.muc.edu.cn",
	snippet: "申请条件与项目费用",
	primaryAction: {
		href: "https://cie.muc.edu.cn/info/1012/123.htm?year=2026#fees",
		external: true,
		label: "打开网页",
		disabledReason: null,
	},
};
const Message = () => <MessagePrimitive.Parts components={{ Text: MarkdownText }} />;
function Fixture({ text, sources = [source] }: { text: string; sources?: SourceItemPayload[] }) {
	const runtime = useExternalStoreRuntime({
		isRunning: false,
		convertMessage: (message) => message,
		messages: [
			{ id: "answer", role: "assistant" as const, content: [{ type: "text" as const, text }] },
		],
		onNew: async () => undefined,
	});
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<CitationSourcesContext.Provider
				value={
					new Map(
						sources.flatMap((item) => item.citationIndexes.map((index) => [index, item] as const)),
					)
				}
			>
				<ThreadPrimitive.MessageByIndex index={0} components={{ Message }} />
			</CitationSourcesContext.Provider>
		</AssistantRuntimeProvider>
	);
}

describe("inline citation preview", () => {
	it("renders grouped and markdown citations as separate previews with direct source links", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<Fixture text="项目[1, 5, 1]；费用[1](https://cie.muc.edu.cn/info/1012/123.htm?year=2026#fees)。" />,
		);
		const triggers = await screen.findAllByRole("button", { name: /查看引用/ });
		expect(triggers).toHaveLength(3);
		expect(container.textContent).not.toContain("[1, 5");
		expect(container.textContent).not.toContain("(https:");
		const trigger = screen.getByRole("button", { name: /查看引用 5/ });
		await user.click(trigger);
		expect(await screen.findByText("民大境外访学项目")).toBeVisible();
		expect(screen.getByText("申请条件与项目费用")).toBeVisible();
		expect(screen.getByRole("link", { name: "打开网页" })).toHaveAttribute(
			"href",
			source.primaryAction.href,
		);
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("link", { name: "打开网页" })).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
	});
	it("opens on keyboard focus and leaves missing references noninteractive", async () => {
		const user = userEvent.setup();
		render(<Fixture text="资料[5]，历史缺失[8]。" />);
		const trigger = await screen.findByRole("button", { name: /查看引用 5/ });
		await user.tab();
		expect(trigger).toHaveFocus();
		expect(await screen.findByRole("link", { name: "打开网页" })).toBeVisible();
		expect(screen.getByLabelText("引用 8：来源不可用").tagName).toBe("SUP");
	});
	it("does not transform code, escaped brackets or ordinary links", async () => {
		const markdown = "`[1]`\n\n```text\n[1, 5]\n```\n\n\\[1] [学校](https://muc.edu.cn)";
		const { container } = render(<Fixture text={markdown} />);
		await act(async () => undefined);
		expect(screen.queryByRole("button", { name: /查看引用/ })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "学校" })).toHaveAttribute(
			"href",
			"https://muc.edu.cn",
		);
		expect(container.querySelector("code")?.textContent).toBe("[1]");
	});
	it("preserves numeric links whose destinations are not the cited source", async () => {
		render(<Fixture text="链接[1](https://example.com/page)；引用[1]。" />);
		expect(await screen.findByRole("link", { name: "1" })).toHaveAttribute(
			"href",
			"https://example.com/page",
		);
		expect(await screen.findAllByRole("button", { name: /查看引用 1/ })).toHaveLength(1);
	});

	it.each(["campus_notice", "campus_document"] as const)(
		"uses the %s internal reader",
		async (kind) => {
			const item: SourceItemPayload =
				kind === "campus_notice"
					? {
							kind,
							citationIndexes: [1],
							title: "访学通知",
							noticeId: "123",
							sectionTitle: "报名",
							snippet: null,
							primaryAction: {
								href: "/notices/123",
								label: "查看通知",
								external: false,
								disabledReason: null,
							},
						}
					: {
							kind,
							citationIndexes: [1],
							title: "访学办法",
							collectionLabel: "学生手册",
							versionSlug: "2026",
							sectionTitle: "费用",
							snippet: null,
							primaryAction: {
								href: "/docs/regulations/visit/v/2026#fees",
								label: "查看文档",
								external: false,
								disabledReason: null,
							},
						};
			render(<Fixture text="要求[1]" sources={[item]} />);
			fireEvent.click(await screen.findByRole("button", { name: /查看引用 1/ }));
			const link = await screen.findByRole("link", { name: item.primaryAction.label });
			expect(link).toHaveAttribute("href", item.primaryAction.href);
			expect(link).not.toHaveAttribute("target");
		},
	);
	it("does not offer a link when a source URL is unavailable", async () => {
		render(
			<Fixture
				text="资料[1]"
				sources={[
					{
						...source,
						primaryAction: {
							href: null,
							label: "打开网页",
							external: true,
							disabledReason: "source_unavailable",
						},
					},
				]}
			/>,
		);
		expect(await screen.findByLabelText("引用 1：来源不可用")).toBeVisible();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});
});
