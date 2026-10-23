import type { StyleDevGroup, StyleDevStory, StyleDevVariant } from "./contracts";
import { ACCOUNT_ENTRIES } from "./examples/account";
import { CONVERSATION_ENTRIES } from "./examples/conversation";
import { DINING_ENTRIES } from "./examples/dining";
import { DOCS_ENTRIES } from "./examples/docs";
import { FORM_ENTRIES } from "./examples/forms";
import { FOUNDATION_ENTRIES } from "./examples/foundations";
import { MAP_ENTRIES } from "./examples/map";
import { OVERLAY_ENTRIES } from "./examples/overlays";

export type { StyleDevGroup, StyleDevStory, StyleDevVariant } from "./contracts";

export const STYLE_DEV_GROUPS: readonly StyleDevGroup[] = [
	"基础与主题",
	"表单与控件",
	"浮层",
	"问答",
	"文档",
	"地图",
	"食堂",
	"账号",
];

export const STYLE_DEV_STORIES: readonly StyleDevStory[] = [
	...FOUNDATION_ENTRIES,
	...FORM_ENTRIES,
	...OVERLAY_ENTRIES,
	...CONVERSATION_ENTRIES,
	...DOCS_ENTRIES,
	...MAP_ENTRIES,
	...DINING_ENTRIES,
	...ACCOUNT_ENTRIES,
];

export function defaultStyleDevVariant(story: StyleDevStory): StyleDevVariant {
	return (
		story.variants.find((variant) => variant.id === story.defaultVariant) ??
		story.variants[0] ??
		(() => {
			throw new Error(`Style-dev story has no variants: ${story.id}`);
		})()
	);
}

export function findStyleDevVariant(
	story: StyleDevStory,
	variantId: string | null,
): StyleDevVariant {
	return (
		(variantIdIsKnown(story, variantId)
			? story.variants.find((variant) => variant.id === variantId)
			: null) ?? defaultStyleDevVariant(story)
	);
}

function variantIdIsKnown(story: StyleDevStory, variantId: string | null): variantId is string {
	return Boolean(variantId && story.variants.some((variant) => variant.id === variantId));
}
