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

	it("supports keyboard selection through the Radix select", async () => {
		const user = userEvent.setup();
		render(
			<Select>
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
		await user.keyboard("{ArrowDown}{Enter}");
		expect(trigger).toHaveTextContent("运行中");
	});

	it("uses semantic tones without accepting domain status values", () => {
		render(<Badge tone="warning">等待用户</Badge>);
		expect(screen.getByText("等待用户")).toHaveClass("text-warning");
	});
});
