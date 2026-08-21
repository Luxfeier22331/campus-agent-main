import { describe, expect, it } from "vitest";
import {
	defaultStyleDevVariant,
	STYLE_DEV_GROUPS,
	STYLE_DEV_STORIES,
} from "../src/style-dev/catalog";

describe("style-dev catalog", () => {
	it("keeps stories and variants uniquely addressable", () => {
		const storyIds = STYLE_DEV_STORIES.map((story) => story.id);
		expect(new Set(storyIds).size).toBe(storyIds.length);

		for (const story of STYLE_DEV_STORIES) {
			expect(STYLE_DEV_GROUPS).toContain(story.group);
			expect(Object.keys(story).sort()).toEqual([
				"defaultVariant",
				"group",
				"id",
				"title",
				"variants",
			]);
			expect(story.variants.length).toBeGreaterThan(0);
			expect(new Set(story.variants.map((variant) => variant.id)).size).toBe(story.variants.length);
			expect(defaultStyleDevVariant(story).id).toBe(story.defaultVariant);
			for (const variant of story.variants) {
				expect(Object.keys(variant).sort()).toEqual(["id", "label", "render"]);
				expect(typeof variant.render).toBe("function");
			}
		}
	});

	it("organizes stories by the supported component families", () => {
		expect(STYLE_DEV_GROUPS).toEqual([
			"基础与主题",
			"表单与控件",
			"浮层",
			"问答",
			"文档",
			"地图",
			"食堂",
			"账号",
		]);
		expect(new Set(STYLE_DEV_STORIES.map((story) => story.group))).toEqual(
			new Set(STYLE_DEV_GROUPS),
		);
	});
});
