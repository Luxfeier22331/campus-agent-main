import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CampusGroupsCatalog } from "campus-contracts/campus-groups";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpsWebApp } from "../src/app/ops-web-app";

const group = {
	id: "qq-760540871",
	joinUrl: null,
	name: "央民二匹马俱乐部",
	qqGroupNumber: "760540871",
	summary: "优俊少女",
	tags: ["优俊少女"],
};

const discordGroup = {
	id: "discord-muc-community",
	joinUrl: "https://discord.gg/XgQqU9zrPZ",
	name: "Discord",
	qqGroupNumber: null,
	summary: "请务必注意保护个人信息安全。",
	tags: ["中央民族大学Discord交流群"],
};

const catalog: CampusGroupsCatalog = {
	schemaVersion: "campus-groups-catalog.v1",
	sections: [
		{ groups: [group, discordGroup], id: "interest-groups", name: "同好群" },
		{ groups: [], id: "clubs", name: "社团群" },
	],
};

describe("同好群运维页面", () => {
	const fixtureFetch = globalThis.fetch;

	afterEach(() => {
		vi.stubGlobal("fetch", fixtureFetch);
	});

	it("按目录顺序展示分组、群和联系方式", async () => {
		vi.stubGlobal("fetch", catalogFetch());

		render(<OpsWebApp initialPath="/groups" />);

		expect(await screen.findByRole("heading", { name: "同好群" })).toBeInTheDocument();
		expect(await screen.findByText("2 个分组 · 2 个群")).toBeInTheDocument();
		const headings = screen.getAllByRole("heading", { level: 3 });
		expect(headings.map((heading) => heading.textContent)).toEqual(["同好群", "社团群"]);
		expect(screen.getByText("QQ 760540871")).toBeInTheDocument();
		expect(screen.getByText("Discord 邀请链接")).toBeInTheDocument();
		expect(screen.getByText("此分组暂无群。")).toBeInTheDocument();
	});

	it("编辑群时可以移动到另一个分组并提交完整目录", async () => {
		let saved: CampusGroupsCatalog | undefined;
		vi.stubGlobal(
			"fetch",
			catalogFetch((next) => {
				saved = next;
				return Response.json(next);
			}),
		);

		render(<OpsWebApp initialPath="/groups" />);
		await screen.findByText(group.name);
		fireEvent.click(screen.getByRole("button", { name: `编辑 ${group.name}` }));
		const dialog = screen.getByRole("dialog", { name: "编辑同好群" });
		fireEvent.change(within(dialog).getByRole("textbox", { name: "群名" }), {
			target: { value: "更新后的同好群" },
		});
		fireEvent.change(within(dialog).getByRole("combobox", { name: "分组" }), {
			target: { value: "clubs" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

		await waitFor(() => expect(saved).toBeDefined());
		expect(saved?.sections[0]?.groups.map(({ id }) => id)).toEqual([discordGroup.id]);
		expect(saved?.sections[1]?.groups).toEqual([
			expect.objectContaining({ id: group.id, name: "更新后的同好群" }),
		]);
		expect(await screen.findByText("同好群已保存。")).toBeInTheDocument();
	});

	it("新增并重命名分组时保留稳定分组 ID", async () => {
		let current = catalog;
		vi.stubGlobal(
			"fetch",
			catalogFetch((next) => {
				current = next;
				return Response.json(next);
			}),
		);

		render(<OpsWebApp initialPath="/groups" />);
		await screen.findByText(group.name);
		fireEvent.click(screen.getByRole("button", { name: "新增分组" }));
		let dialog = screen.getByRole("dialog", { name: "新增分组" });
		fireEvent.change(within(dialog).getByRole("textbox", { name: "分组名称" }), {
			target: { value: "兴趣社群" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

		await screen.findByRole("heading", { name: "兴趣社群" });
		const created = current.sections.at(-1);
		expect(created?.id).toMatch(/^section-/u);
		fireEvent.click(screen.getByRole("button", { name: "重命名分组“兴趣社群”" }));
		dialog = screen.getByRole("dialog", { name: "重命名分组" });
		fireEvent.change(within(dialog).getByRole("textbox", { name: "分组名称" }), {
			target: { value: "其他社群" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

		await screen.findByRole("heading", { name: "其他社群" });
		expect(current.sections.at(-1)?.id).toBe(created?.id);
	});

	it("删除非空分组前显示受影响群数量", async () => {
		let saved: CampusGroupsCatalog | undefined;
		vi.stubGlobal(
			"fetch",
			catalogFetch((next) => {
				saved = next;
				return Response.json(next);
			}),
		);

		render(<OpsWebApp initialPath="/groups" />);
		await screen.findByText(group.name);
		fireEvent.click(screen.getByRole("button", { name: "删除分组“同好群”" }));
		const confirmation = screen.getByRole("alertdialog");
		expect(confirmation).toHaveTextContent("该分组中的 2 个群将同时删除。");
		fireEvent.click(within(confirmation).getByRole("button", { name: "确认" }));

		await waitFor(() => expect(saved?.sections.map(({ id }) => id)).toEqual(["clubs"]));
		expect(await screen.findByText("分组已删除。")).toBeInTheDocument();
	});

	it("写入失败保留编辑器且不重复请求", async () => {
		let writes = 0;
		vi.stubGlobal(
			"fetch",
			catalogFetch(() => {
				writes += 1;
				return Response.json(
					{ error: { code: "groups_catalog_invalid", message: "目录内容无效。" } },
					{ status: 422 },
				);
			}),
		);

		render(<OpsWebApp initialPath="/groups" />);
		await screen.findByText(group.name);
		fireEvent.click(screen.getByRole("button", { name: `编辑 ${group.name}` }));
		const dialog = screen.getByRole("dialog", { name: "编辑同好群" });
		fireEvent.change(within(dialog).getByRole("textbox", { name: "标签（用逗号分隔）" }), {
			target: { value: "音乐，校园" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

		expect(await within(dialog).findByText("保存失败")).toBeInTheDocument();
		expect(within(dialog).getByText("目录内容无效。")).toBeInTheDocument();
		expect(writes).toBe(1);
	});
});

function catalogFetch(
	onWrite?: (catalog: CampusGroupsCatalog) => Response,
): ReturnType<typeof vi.fn<typeof fetch>> {
	return vi.fn<typeof fetch>(async (input, init) => {
		const path = requestPath(input);
		if (path === "/api/ops/groups/catalog" && init?.method === "PUT") {
			const next = JSON.parse(String(init.body)) as CampusGroupsCatalog;
			return onWrite?.(next) ?? Response.json(next);
		}
		if (path === "/api/ops/groups/catalog") {
			return Response.json(catalog);
		}
		throw new Error(`Unexpected request: ${String(input)}`);
	});
}

function requestPath(input: RequestInfo | URL): string {
	return typeof input === "string"
		? new URL(input, "https://ops.example.test").pathname
		: input instanceof Request
			? new URL(input.url).pathname
			: new URL(input.toString()).pathname;
}
