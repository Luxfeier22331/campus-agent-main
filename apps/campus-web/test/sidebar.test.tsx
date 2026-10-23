import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { Sidebar, SidebarProvider, SidebarTrigger, useSidebar } from "../src/components/ui/sidebar";

function SidebarFixture() {
	return (
		<SidebarProvider>
			<Sidebar id="sidebar-target">
				<div>侧栏内容</div>
			</Sidebar>
			<SidebarTrigger aria-label="聊天记录切换" />
			<textarea aria-label="消息输入" />
			<div contentEditable data-testid="editable-area" suppressContentEditableWarning />
		</SidebarProvider>
	);
}

function MultipleTriggerFixture() {
	return (
		<SidebarProvider>
			<SidebarTrigger aria-label="移动入口" registerAsMobileOpener />
			<SidebarTrigger aria-label="桌面切换" />
			<FocusMobileOpener />
		</SidebarProvider>
	);
}

function FocusMobileOpener() {
	const { mobileOpenerRef } = useSidebar();
	return (
		<button onClick={() => mobileOpenerRef.current?.focus()} type="button">
			恢复移动入口焦点
		</button>
	);
}

describe("Sidebar primitive", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("exposes stateful accessible trigger semantics", async () => {
		const user = userEvent.setup();
		render(<SidebarFixture />);

		const trigger = screen.getByRole("button", { name: "聊天记录切换" });
		const sidebar = document.getElementById("sidebar-target");
		expect(trigger).toHaveAttribute("aria-expanded", "true");
		expect(trigger).toHaveAttribute("data-state", "expanded");
		expect(sidebar).toHaveAttribute("data-state", "expanded");

		await user.click(trigger);

		expect(trigger).toHaveAttribute("aria-expanded", "false");
		expect(trigger).toHaveAttribute("data-state", "collapsed");
		expect(sidebar).toHaveAttribute("data-state", "collapsed");
	});

	it("does not steal Control+B from editable controls", () => {
		render(<SidebarFixture />);
		const sidebar = document.getElementById("sidebar-target");
		const textarea = screen.getByRole("textbox", { name: "消息输入" });
		const contentEditable = screen.getByTestId("editable-area");

		textarea.focus();
		fireEvent.keyDown(textarea, { ctrlKey: true, key: "b" });
		expect(sidebar).toHaveAttribute("data-state", "expanded");

		contentEditable.focus();
		fireEvent.keyDown(contentEditable, { ctrlKey: true, key: "b" });
		expect(sidebar).toHaveAttribute("data-state", "expanded");

		fireEvent.keyDown(window, { ctrlKey: true, key: "b" });
		expect(sidebar).toHaveAttribute("data-state", "collapsed");
	});

	it("keeps the registered mobile opener when another sidebar trigger mounts", async () => {
		const user = userEvent.setup();
		render(<MultipleTriggerFixture />);

		await user.click(screen.getByRole("button", { name: "恢复移动入口焦点" }));

		expect(screen.getByRole("button", { name: "移动入口" })).toHaveFocus();
	});
});
