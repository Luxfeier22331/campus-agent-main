import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Badge,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	Checkbox,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "../src";

beforeEach(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
		},
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("selection and status surfaces", () => {
	it.each(["underline", "segmented"] as const)(
		"preserves tab keyboard navigation with %s presentation",
		async (presentation) => {
			const user = userEvent.setup();
			render(
				<Tabs defaultValue="commute">
					<TabsList presentation={presentation} aria-label="服务">
						<TabsTrigger value="commute">两校区通勤</TabsTrigger>
						<TabsTrigger value="disabled" disabled>
							未开放
						</TabsTrigger>
						<TabsTrigger value="metro">地铁接驳</TabsTrigger>
					</TabsList>
					<TabsContent value="commute">通勤班次</TabsContent>
					<TabsContent value="metro">接驳班次</TabsContent>
				</Tabs>,
			);
			await user.tab();
			expect(screen.getByRole("tab", { name: "两校区通勤" })).toHaveFocus();
			await user.keyboard("{ArrowRight}");
			const selected = screen.getByRole("tab", { name: "地铁接驳" });
			expect(selected).toHaveFocus();
			expect(selected).toHaveAttribute("aria-selected", "true");
			expect(screen.getByRole("tabpanel")).toHaveTextContent("接驳班次");
			expect(screen.getByRole("tabpanel").id).toBe(selected.getAttribute("aria-controls"));
			expect(screen.getByRole("tab", { name: "未开放" })).toBeDisabled();
		},
	);

	it("keeps checkbox label, mixed state, ref, form value and disabled behavior", async () => {
		const user = userEvent.setup();
		const ref = createRef<HTMLButtonElement>();
		const onDisabledChange = vi.fn();
		const { container } = render(
			<form>
				<label htmlFor="days">适用日期</label>
				<Checkbox
					id="days"
					ref={ref}
					name="days"
					value="weekdays"
					defaultChecked="indeterminate"
					aria-invalid
				/>
				<label htmlFor="locked">锁定选项</label>
				<Checkbox id="locked" disabled defaultChecked onCheckedChange={onDisabledChange} />
			</form>,
		);
		expect(ref.current).toBe(screen.getByRole("checkbox", { name: "适用日期" }));
		expect(ref.current).toHaveAttribute("aria-checked", "mixed");
		expect(ref.current).toHaveAttribute("aria-invalid", "true");
		await user.click(screen.getByText("适用日期"));
		expect(ref.current).toBeChecked();
		expect(new FormData(container.querySelector("form") ?? undefined).get("days")).toBe("weekdays");
		await user.keyboard(" ");
		expect(ref.current).not.toBeChecked();
		await user.click(screen.getByText("锁定选项"));
		expect(onDisabledChange).not.toHaveBeenCalled();
		expect(screen.getByRole("checkbox", { name: "锁定选项" })).toBeDisabled();
	});

	it("retains heading, status semantics, refs and consumer class overrides", () => {
		const ref = createRef<HTMLDivElement>();
		render(
			<Card ref={ref} className="p-2">
				<CardHeader>
					<CardTitle>排班</CardTitle>
				</CardHeader>
				<CardContent className="p-3">
					<Badge tone="success">已保存</Badge>
					<Alert tone="warning" role="status">
						<AlertTitle>确认日期</AlertTitle>
						<AlertDescription>调整将在下周生效。</AlertDescription>
					</Alert>
				</CardContent>
			</Card>,
		);
		expect(ref.current).toHaveClass("p-2");
		expect(ref.current?.querySelector('[data-slot="card-content"]')).toHaveClass("p-3");
		expect(ref.current?.querySelector('[data-slot="card-content"]')).not.toHaveClass("pt-0");
		expect(screen.getByRole("heading", { name: "排班" })).toBeVisible();
		expect(screen.getByRole("status")).toHaveTextContent("调整将在下周生效。");
		expect(screen.getByText("已保存")).not.toHaveAttribute("tabindex");
	});
});
