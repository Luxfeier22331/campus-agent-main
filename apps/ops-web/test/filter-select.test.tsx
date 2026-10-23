import { Field } from "@campus-agent/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterSelect } from "../src/app/ui/filter-select";

afterEach(() => vi.unstubAllGlobals());

function viewport(desktop: boolean) {
	vi.stubGlobal("matchMedia", () => ({
		matches: desktop,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	}));
	HTMLElement.prototype.scrollIntoView = vi.fn();
}

function Form({ disabled = false, required = false }: { disabled?: boolean; required?: boolean }) {
	const [value, setValue] = useState("");
	return (
		<form aria-label="选择表单">
			<Field label="任务周期" error={required && !value ? "请选择周期" : undefined}>
				<FilterSelect
					name="interval"
					value={value}
					disabled={disabled}
					required={required}
					onValueChange={setValue}
					options={[
						{ value: "", label: "请选择" },
						{ value: "15", label: "15 分钟" },
						{ value: "30", label: "30 分钟", disabled: true },
					]}
				/>
			</Field>
		</form>
	);
}

for (const desktop of [false, true]) {
	describe(desktop ? "desktop select" : "mobile picker", () => {
		it("submits real empty and numeric values, preserves disabled options and label association", async () => {
			viewport(desktop);
			render(<Form />);
			const form = screen.getByRole("form") as HTMLFormElement;
			const control = screen.getByRole("combobox", { name: "任务周期" });
			expect(new FormData(form).getAll("interval")).toEqual([""]);
			if (desktop) {
				fireEvent.keyDown(control, { key: "ArrowDown" });
				expect(await screen.findByRole("option", { name: "30 分钟" })).toHaveAttribute(
					"aria-disabled",
					"true",
				);
				const option = screen.getByRole("option", { name: "15 分钟" });
				fireEvent.pointerDown(option, { pointerType: "mouse" });
				fireEvent.click(option);
			} else {
				expect(screen.getByRole("option", { name: "30 分钟" })).toBeDisabled();
				fireEvent.change(control, { target: { value: "15" } });
			}
			expect(new FormData(form).getAll("interval")).toEqual(["15"]);
		});

		it("keeps required validation and error descriptions on the control", () => {
			viewport(desktop);
			render(<Form required />);
			const form = screen.getByRole("form") as HTMLFormElement;
			expect(form.checkValidity()).toBe(false);
			expect(screen.getByRole("combobox", { name: "任务周期" })).toHaveAccessibleDescription(
				"请选择周期",
			);
		});

		it("omits disabled fields from submission", () => {
			viewport(desktop);
			render(<Form disabled />);
			expect(screen.getByRole("combobox", { name: "任务周期" })).toBeDisabled();
			expect(new FormData(screen.getByRole("form") as HTMLFormElement).has("interval")).toBe(false);
		});
	});
}
