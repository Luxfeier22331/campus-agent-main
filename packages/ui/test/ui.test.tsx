import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogTitle,
	Badge,
	Button,
	Checkbox,
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
	Field,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../src";

beforeAll(() => {
	Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

describe("shared UI primitives", () => {
	it("forwards button refs and preserves native disabled behavior", () => {
		const ref = createRef<HTMLButtonElement>();
		render(
			<Button disabled ref={ref}>
				保存
			</Button>,
		);

		expect(ref.current).toBe(screen.getByRole("button", { name: "保存" }));
		expect(ref.current).toBeDisabled();
		expect(ref.current).toHaveAttribute("type", "button");
	});
	it("keeps native keyboard activation and does not submit forms by default", async () => {
		const user = userEvent.setup();
		const click = vi.fn();
		const submit = vi.fn((event) => event.preventDefault());
		render(
			<form onSubmit={submit}>
				<Button onClick={click}>预览</Button>
				<Button disabled onClick={click}>
					不可用
				</Button>
				<Button type="submit">提交</Button>
			</form>,
		);
		await user.tab();
		expect(screen.getByRole("button", { name: "预览" })).toHaveFocus();
		await user.keyboard("{Enter} ");
		expect(click).toHaveBeenCalledTimes(2);
		expect(submit).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "不可用" }));
		expect(click).toHaveBeenCalledTimes(2);
		await user.click(screen.getByRole("button", { name: "提交" }));
		expect(submit).toHaveBeenCalledTimes(1);
	});
	it("preserves asChild links and consumer class overrides", () => {
		render(
			<Button asChild variant="outline" className="rounded-lg">
				<a href="/transport">班车</a>
			</Button>,
		);
		const link = screen.getByRole("link", { name: "班车" });
		expect(link).toHaveAttribute("href", "/transport");
		expect(link).not.toHaveAttribute("type");
		expect(link).toHaveClass("rounded-lg");
		expect(link).not.toHaveClass("rounded-full");
	});
	it("keeps busy state supplied by the caller without changing the accessible name", () => {
		render(
			<Button disabled aria-busy>
				保存中…
			</Button>,
		);
		expect(screen.getByRole("button", { name: "保存中…" })).toHaveAttribute("aria-busy", "true");
	});

	it("toggles checkboxes through their accessible label", async () => {
		const user = userEvent.setup();
		render(
			<label htmlFor="archived-content">
				<Checkbox id="archived-content" />
				显示已归档内容
			</label>,
		);

		const checkbox = screen.getByRole("checkbox", { name: "显示已归档内容" });
		await user.click(checkbox);
		expect(checkbox).toBeChecked();
	});

	it("connects field labels, descriptions, and errors to the control", () => {
		render(
			<Field description="使用服务地址" error="地址无效" label="Base URL">
				<Input />
			</Field>,
		);

		const input = screen.getByRole("textbox", { name: "Base URL" });
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(input.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
		expect(screen.getByText("地址无效")).toHaveAttribute("id");
	});

	it("preserves child control semantics while adding field errors", () => {
		render(
			<Field error="地址无效" label="Base URL">
				<Input aria-describedby="external-help" aria-invalid="true" id="base-url" />
			</Field>,
		);

		const input = screen.getByRole("textbox", { name: "Base URL" });
		expect(input).toHaveAttribute("id", "base-url");
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(input.getAttribute("aria-describedby")?.split(" ")).toEqual([
			"external-help",
			"base-url-error",
		]);
	});

	it("omits optional aria attributes when the field does not use them", () => {
		render(
			<Field label="Base URL">
				<Input />
			</Field>,
		);

		const input = screen.getByRole("textbox", { name: "Base URL" });
		expect(input).not.toHaveAttribute("aria-describedby");
		expect(input).not.toHaveAttribute("aria-invalid");
	});

	it("styles AlertDialog headings and descriptions", () => {
		render(
			<AlertDialog open>
				<AlertDialogContent>
					<AlertDialogTitle>确认</AlertDialogTitle>
					<AlertDialogDescription>此操作不可恢复。</AlertDialogDescription>
				</AlertDialogContent>
			</AlertDialog>,
		);

		expect(screen.getByRole("heading", { name: "确认" })).toHaveClass("text-lg");
		expect(screen.getByText("此操作不可恢复。")).toHaveClass("text-muted-foreground");
	});

	it("restores focus when a dialog closes with Escape", async () => {
		const user = userEvent.setup();
		render(
			<Dialog>
				<DialogTrigger asChild>
					<Button>打开设置</Button>
				</DialogTrigger>
				<DialogContent>
					<DialogTitle>设置</DialogTitle>
					<Button>保存</Button>
				</DialogContent>
			</Dialog>,
		);

		const trigger = screen.getByRole("button", { name: "打开设置" });
		await user.click(trigger);
		expect(screen.getByRole("dialog")).toBeInTheDocument();
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
	});

	it("supports keyboard selection without locking page interactions", async () => {
		const user = userEvent.setup();
		render(
			<Select items={{ running: "运行中", completed: "已完成" }}>
				<SelectTrigger aria-label="状态">
					<SelectValue placeholder="选择状态" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="running">运行中</SelectItem>
					<SelectItem value="completed">已完成</SelectItem>
				</SelectContent>
			</Select>,
		);

		const trigger = screen.getByRole("combobox", { name: "状态" });
		trigger.focus();
		await user.keyboard("{ArrowDown}");
		expect(await screen.findByRole("listbox")).toBeVisible();
		expect(document.body).not.toHaveAttribute("data-scroll-locked");
		await user.keyboard("{Enter}");
		expect(trigger).toHaveTextContent("运行中");
	});
	it("uses a single focus ring contract for bordered form controls", () => {
		render(
			<>
				<Input aria-label="关键词" />
				<Select items={{ running: "运行中", completed: "已完成" }}>
					<SelectTrigger aria-label="状态">
						<SelectValue placeholder="选择状态" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="running">运行中</SelectItem>
					</SelectContent>
				</Select>
			</>,
		);
		const input = screen.getByRole("textbox", { name: "关键词" });
		const trigger = screen.getByRole("combobox", { name: "状态" });
		for (const control of [input, trigger]) {
			expect(control).toHaveClass("border", "focus-visible:outline-none", "focus-visible:ring-2");
			expect(control).toHaveClass("focus-visible:ring-offset-0");
			expect(control).not.toHaveClass("focus-visible:ring-offset-2");
		}
	});
	it("keeps buttons on the same focus ring contract", () => {
		render(<Button>保存</Button>);
		const button = screen.getByRole("button", { name: "保存" });
		expect(button).toHaveClass("focus-visible:outline-none", "focus-visible:ring-2");
		expect(button).toHaveClass("focus-visible:ring-offset-0");
		expect(button).not.toHaveClass("focus-visible:ring-offset-2");
	});

	it("uses semantic tones without accepting domain status values", () => {
		render(
			<>
				<Badge tone="info">信息</Badge>
				<Badge tone="warning">等待用户</Badge>
			</>,
		);
		expect(screen.getByText("信息")).toHaveClass(
			"border-info-border",
			"bg-info-subtle",
			"text-info",
		);
		expect(screen.getByText("信息")).not.toHaveClass("bg-primary", "shadow");
		expect(screen.getByText("等待用户")).toHaveClass("text-warning");
	});

	it("uses explicit primary interaction and disabled color states", () => {
		render(<Button disabled>保存</Button>);
		expect(screen.getByRole("button", { name: "保存" })).toHaveClass(
			"border",
			"border-primary-foreground/20",
			"hover:bg-primary-hover",
			"active:bg-primary-pressed",
			"disabled:border-border-default",
			"disabled:bg-[var(--state-disabled-bg)]",
			"disabled:text-[var(--state-disabled-text)]",
		);
		expect(screen.getByRole("button", { name: "保存" })).not.toHaveClass("disabled:opacity-50");
	});
});
