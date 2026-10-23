import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiningStylePanel } from "../src/app/dining-studio/tldraw-properties";
import type { DiningPathShape } from "../src/app/dining-studio/tldraw-shapes";

const editor = vi.hoisted(() => ({
	bailToMark: vi.fn(),
	getContainer: vi.fn(),
	getAncestorPageId: vi.fn(),
	getPage: vi.fn(),
	getOnlySelectedShape: vi.fn(),
	getShape: vi.fn(),
	markHistoryStoppingPoint: vi.fn(),
	updateShape: vi.fn(),
}));

vi.mock("tldraw", async (importOriginal) => {
	window.matchMedia = vi.fn().mockReturnValue({
		addEventListener: vi.fn(),
		matches: false,
		removeEventListener: vi.fn(),
	});
	return {
		...(await importOriginal<typeof import("tldraw")>()),
		useEditor: () => editor,
		useValue: (_name: string, getValue: () => unknown) => getValue(),
		TldrawUiButton: ({
			type: _type,
			...props
		}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { type?: string }) => (
			<button {...props} type="button" />
		),
		TldrawUiButtonIcon: () => null,
	};
});

beforeEach(() => {
	vi.clearAllMocks();
	editor.getContainer.mockReturnValue(document.body);
	editor.getAncestorPageId.mockReturnValue("page:page");
	editor.getPage.mockReturnValue({ meta: {} });
	editor.getShape.mockImplementation(() => editor.getOnlySelectedShape());
});

describe("Dining outline properties", () => {
	it("allows adding and removing outline nodes while keeping at least three", () => {
		let shape = outlineShape();
		editor.getOnlySelectedShape.mockImplementation(() => shape);
		editor.updateShape.mockImplementation((update: Partial<DiningPathShape>) => {
			shape = { ...shape, ...update, props: { ...shape.props, ...update.props } };
		});
		const view = render(<DiningStylePanel />);
		const originalPoints = shape.props.points;
		fireEvent.click(screen.getByTitle("添加节点"));
		expect(shape.props.points).toEqual([
			...originalPoints.map((point) => ({ x: point.x + 20, y: point.y + 30 })),
			{ x: 20, y: 130 },
		]);
		expect(shape).toMatchObject({ x: 0, y: 0 });
		view.rerender(<DiningStylePanel />);
		fireEvent.click(screen.getByTitle("删除节点 5"));
		view.rerender(<DiningStylePanel />);
		fireEvent.click(screen.getByTitle("删除节点 4"));
		view.rerender(<DiningStylePanel />);
		expect(shape.props.points).toHaveLength(3);
		for (const button of screen.getAllByTitle(/^删除节点 /)) {
			expect(button).toBeDisabled();
		}
		fireEvent.click(screen.getByTitle("删除节点 3"));
		expect(editor.updateShape).toHaveBeenCalledTimes(3);
	});

	it("keeps manually locked outlines read only", () => {
		editor.getOnlySelectedShape.mockReturnValue({ ...outlineShape(), isLocked: true });
		render(<DiningStylePanel />);
		expect(screen.getByText("元素已锁定，解锁后可编辑")).toBeVisible();
		expect(screen.queryByTitle("添加节点")).not.toBeInTheDocument();
		expect(screen.queryByTitle(/^删除节点 /)).not.toBeInTheDocument();
		expect(editor.updateShape).not.toHaveBeenCalled();
	});
});

describe("Dining partition nodes", () => {
	function renderPartition(
		points = [
			{ x: 0, y: 0 },
			{ x: 160, y: 0 },
		],
	) {
		let shape = outlineShape();
		shape = {
			...shape,
			id: "shape:partition" as DiningPathShape["id"],
			props: { closed: false, entityId: "partition-01", layer: "partition", points },
		};
		editor.getOnlySelectedShape.mockImplementation(() => shape);
		editor.updateShape.mockImplementation((update: Partial<DiningPathShape>) => {
			shape = { ...shape, ...update, props: { ...shape.props, ...update.props } };
		});
		const view = render(<DiningStylePanel />);
		return { getShape: () => shape, rerender: () => view.rerender(<DiningStylePanel />) };
	}

	it("sets absolute coordinates on Enter and blur without replacing the input", () => {
		const view = renderPartition();
		const x = screen.getByRole("textbox", { name: "节点 1 X" });
		expect(x).toHaveValue("20");
		act(() => x.focus());
		fireEvent.change(x, { target: { value: "100" } });
		expect(editor.updateShape).not.toHaveBeenCalled();
		fireEvent.keyDown(x, { key: "Enter" });
		view.rerender();
		expect(view.getShape()).toMatchObject({ x: 0, y: 0 });
		expect(view.getShape().props.points).toEqual([
			{ x: 100, y: 30 },
			{ x: 180, y: 30 },
		]);
		expect(screen.getByRole("textbox", { name: "节点 1 X" })).toBe(x);
		expect(editor.markHistoryStoppingPoint).toHaveBeenCalledTimes(1);
		const y = screen.getByRole("textbox", { name: "节点 2 Y" });
		act(() => y.focus());
		fireEvent.change(y, { target: { value: "220" } });
		act(() => y.blur());
		view.rerender();
		expect(view.getShape().props.points).toEqual([
			{ x: 100, y: 30 },
			{ x: 180, y: 220 },
		]);
		expect(editor.markHistoryStoppingPoint).toHaveBeenCalledTimes(2);
	});

	it("inserts a bend between endpoints and keeps at least two nodes", () => {
		const view = renderPartition();
		expect(screen.getByTitle("删除节点 1")).toBeDisabled();
		fireEvent.click(screen.getByTitle("在节点 1 后插入节点"));
		view.rerender();
		expect(view.getShape().props.points).toEqual([
			{ x: 20, y: 30 },
			{ x: 100, y: 30 },
			{ x: 180, y: 30 },
		]);
		const y = screen.getByRole("textbox", { name: "节点 2 Y" });
		act(() => y.focus());
		fireEvent.change(y, { target: { value: "80" } });
		fireEvent.keyDown(y, { key: "Enter" });
		view.rerender();
		expect(view.getShape().props.points[1]).toEqual({ x: 100, y: 80 });
		fireEvent.click(screen.getByTitle("删除节点 2"));
		view.rerender();
		expect(view.getShape().props.points).toEqual([
			{ x: 20, y: 30 },
			{ x: 180, y: 30 },
		]);
		expect(screen.getByTitle("删除节点 1")).toBeDisabled();
		expect(screen.getByTitle("在节点 2 后插入节点")).toBeDisabled();
	});

	it("inserts within the final segment even when the endpoint is on the canvas edge", () => {
		const view = renderPartition([
			{ x: 1160, y: 0 },
			{ x: 1260, y: 0 },
		]);
		fireEvent.click(screen.getByTitle("添加节点"));
		view.rerender();
		expect(view.getShape().props.points).toEqual([
			{ x: 1180, y: 30 },
			{ x: 1230, y: 30 },
			{ x: 1280, y: 30 },
		]);
	});

	it("displays the clamped coordinate even when the boundary value does not change", () => {
		const view = renderPartition([
			{ x: 1160, y: 0 },
			{ x: 1260, y: 0 },
		]);
		const x = screen.getByRole("textbox", { name: "节点 2 X" });
		act(() => x.focus());
		fireEvent.change(x, { target: { value: "2000" } });
		fireEvent.keyDown(x, { key: "Enter" });
		view.rerender();
		expect(view.getShape().props.points[1]?.x).toBe(1280);
		expect(x).toHaveValue("1280");
	});

	it("cancels coordinate changes on Escape and rejects invalid numeric input", () => {
		renderPartition();
		const x = screen.getByRole("textbox", { name: "节点 1 X" });
		act(() => x.focus());
		fireEvent.change(x, { target: { value: "300" } });
		fireEvent.keyDown(x, { key: "Escape" });
		expect(x).toHaveValue("20");
		expect(editor.updateShape).not.toHaveBeenCalled();
		act(() => x.focus());
		fireEvent.change(x, { target: { value: "abc" } });
		fireEvent.keyDown(x, { key: "Enter" });
		expect(screen.getByText("请输入有效数字")).toBeVisible();
		expect(editor.updateShape).not.toHaveBeenCalled();
		expect(editor.bailToMark).toHaveBeenCalled();
	});

	it("edits nodes throughout an enlarged layout and clamps at its own bounds", () => {
		editor.getPage.mockReturnValue({ meta: { diningCanvas: { width: 2560, height: 1520 } } });
		const view = renderPartition();
		const x = screen.getByRole("textbox", { name: "节点 2 X" });
		act(() => x.focus());
		fireEvent.change(x, { target: { value: "2200" } });
		fireEvent.keyDown(x, { key: "Enter" });
		view.rerender();
		expect(view.getShape().props.points[1]?.x).toBe(2200);
		const y = screen.getByRole("textbox", { name: "节点 2 Y" });
		act(() => y.focus());
		fireEvent.change(y, { target: { value: "2000" } });
		fireEvent.keyDown(y, { key: "Enter" });
		view.rerender();
		expect(view.getShape().props.points[1]).toEqual({ x: 2200, y: 1520 });
		expect(y).toHaveValue("1520");
	});
});

function outlineShape(): DiningPathShape {
	return {
		id: "shape:outline",
		index: "a1",
		isLocked: false,
		meta: {},
		opacity: 1,
		parentId: "page:page",
		props: {
			closed: true,
			entityId: "outline",
			layer: "outline",
			points: [
				{ x: 0, y: 0 },
				{ x: 200, y: 0 },
				{ x: 200, y: 200 },
				{ x: 0, y: 200 },
			],
		},
		rotation: 0,
		type: "dining-path",
		typeName: "shape",
		x: 20,
		y: 30,
	} as DiningPathShape;
}
