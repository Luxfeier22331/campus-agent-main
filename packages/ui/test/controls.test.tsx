import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	Disclosure,
	DisclosureSummary,
	Field,
	Input,
	NativeSelect,
	Textarea,
	ToggleGroup,
	ToggleGroupItem,
} from "../src";

afterEach(cleanup);

describe("form and selection primitives", () => {
	it("preserves native values, refs, readonly, disabled and field errors", async () => {
		const user = userEvent.setup();
		const ref = createRef<HTMLInputElement>();
		render(
			<>
				<Field label="日期" error="请选择日期">
					<Input type="date" ref={ref} defaultValue="2026-09-11" />
				</Field>
				<Field label="标识">
					<Input readOnly value="route:one" />
				</Field>
				<label htmlFor="audience">乘车人群</label>
				<NativeSelect id="audience" defaultValue="student">
					<option value="student">学生</option>
					<option value="teacher">教师</option>
				</NativeSelect>
				<Field label="备注">
					<Textarea defaultValue="候车说明" />
				</Field>
				<fieldset disabled>
					<Field label="停用字段">
						<Input defaultValue="不可编辑" />
					</Field>
					<label htmlFor="disabled-choice">停用选择</label>
					<NativeSelect id="disabled-choice">
						<option>不可更改</option>
					</NativeSelect>
				</fieldset>
			</>,
		);
		expect(ref.current).toBe(screen.getByLabelText("日期"));
		expect(ref.current).toHaveValue("2026-09-11");
		expect(ref.current).toHaveAttribute("aria-invalid", "true");
		expect(ref.current).toHaveAccessibleDescription("请选择日期");
		await user.type(screen.getByLabelText("标识"), "change");
		expect(screen.getByLabelText("标识")).toHaveValue("route:one");
		await user.selectOptions(screen.getByLabelText("乘车人群"), "teacher");
		expect(screen.getByLabelText("乘车人群")).toHaveValue("teacher");
		await user.type(screen.getByLabelText("备注"), "。");
		expect(screen.getByLabelText("备注")).toHaveValue("候车说明。");
		expect(screen.getByLabelText("停用字段")).toBeDisabled();
		expect(screen.getByLabelText("停用选择")).toBeDisabled();
	});

	it("supports keyboard single selection without submitting or clearing the current choice", async () => {
		const user = userEvent.setup();
		const submit = vi.fn((e) => e.preventDefault());
		function Harness() {
			const [value, setValue] = useState("all");
			return (
				<form onSubmit={submit}>
					<ToggleGroup
						type="single"
						presentation="segmented"
						value={value}
						onValueChange={(next) => next && setValue(next)}
						aria-label="人群"
					>
						<ToggleGroupItem value="all">全部</ToggleGroupItem>
						<ToggleGroupItem value="student">学生</ToggleGroupItem>
						<ToggleGroupItem value="teacher" disabled>
							教师
						</ToggleGroupItem>
					</ToggleGroup>
				</form>
			);
		}
		render(<Harness />);
		await user.tab();
		expect(screen.getByRole("radio", { name: "全部" })).toHaveFocus();
		await user.keyboard("{ArrowRight} ");
		expect(screen.getByRole("radio", { name: "学生" })).toHaveAttribute("aria-checked", "true");
		await user.click(screen.getByRole("radio", { name: "学生" }));
		expect(screen.getByRole("radio", { name: "学生" })).toHaveAttribute("aria-checked", "true");
		expect(screen.getByRole("radio", { name: "教师" })).toBeDisabled();
		expect(submit).not.toHaveBeenCalled();
	});

	it("keeps multiple selections independent and reserves the check indicator", async () => {
		const user = userEvent.setup();
		const ref = createRef<HTMLButtonElement>();
		function Harness() {
			const [values, setValues] = useState(["1"]);
			return (
				<ToggleGroup
					type="multiple"
					presentation="chips"
					value={values}
					onValueChange={setValues}
					aria-label="星期"
				>
					<ToggleGroupItem ref={ref} value="1">
						周一
					</ToggleGroupItem>
					<ToggleGroupItem value="2">周二</ToggleGroupItem>
				</ToggleGroup>
			);
		}
		render(<Harness />);
		const first = screen.getByRole("button", { name: "周一" });
		const second = screen.getByRole("button", { name: "周二" });
		expect(ref.current).toBe(first);
		expect(first).toHaveAttribute("aria-pressed", "true");
		expect(second).toHaveAttribute("aria-pressed", "false");
		const indicator = second.querySelector("svg");
		expect(indicator).toHaveAttribute("aria-hidden", "true");
		await user.click(second);
		expect(first).toHaveAttribute("aria-pressed", "true");
		expect(second).toHaveAttribute("aria-pressed", "true");
		expect(second.querySelector("svg")).toBe(indicator);
		await user.click(first);
		expect(first).toHaveAttribute("aria-pressed", "false");
		expect(second).toHaveAttribute("aria-pressed", "true");
	});
});

describe("native disclosures", () => {
	it("keeps native open state and refs across content updates", async () => {
		const user = userEvent.setup();
		const ref = createRef<HTMLDetailsElement>();
		const summaryRef = createRef<HTMLElement>();
		const { rerender } = render(
			<Disclosure ref={ref}>
				<DisclosureSummary ref={summaryRef}>乘车指引</DisclosureSummary>
				<p>请提前候车</p>
			</Disclosure>,
		);
		expect(ref.current?.open).toBe(false);
		expect(summaryRef.current?.tagName).toBe("SUMMARY");
		await user.click(screen.getByText("乘车指引"));
		expect(ref.current?.open).toBe(true);
		rerender(
			<Disclosure ref={ref}>
				<DisclosureSummary ref={summaryRef}>乘车指引</DisclosureSummary>
				<p>更新后的候车说明</p>
			</Disclosure>,
		);
		expect(ref.current?.open).toBe(true);
		expect(screen.getByText("更新后的候车说明")).toBeVisible();
		await user.click(screen.getByText("乘车指引"));
		expect(ref.current?.open).toBe(false);
	});
});
