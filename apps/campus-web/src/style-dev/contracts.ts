import type { ReactElement } from "react";

export type StyleDevGroup =
	| "基础与主题"
	| "表单与控件"
	| "浮层"
	| "问答"
	| "文档"
	| "地图"
	| "食堂"
	| "账号";

export interface StyleDevVariant {
	id: string;
	label: string;
	render: () => ReactElement;
}

export interface StyleDevStory {
	id: string;
	group: StyleDevGroup;
	title: string;
	defaultVariant: string;
	variants: readonly StyleDevVariant[];
}
