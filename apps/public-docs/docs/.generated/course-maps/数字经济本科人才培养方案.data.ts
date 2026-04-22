const data = {
	generatedAt: "2026-04-22T22:51:05.481160+00:00",
	documentTitle: "数字经济本科人才培养方案",
	documentId: "curriculum:数字经济本科人才培养方案",
	rawAssetId: "asset:curriculum-plan-2022",
	rawVersionId: "sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67",
	blocks: [
		{
			blockId: "page-0257-page-0257-block-mineru-block-0006-0006-map-01",
			title: "六、课程地图",
			status: "partial",
			titleConfidence: "absent",
			pageNumber: 257,
			rowId: "page-0257-block-mineru-block-0006-0006",
			mapIndex: 1,
			parentHeadingHint: "六、课程地图",
			displayStageLabels: [
				"大一下",
				"大二上",
				"大二下",
				"大三上",
				"大三下",
				"大四"
			],
			extractionNotes: [
				"当前裁切区域仅识别到 1 张完整课程地图，未拆分出更多独立子图。",
				"本区域左侧起始列（大一上）仅部分可见，因此未纳入任何来自该列且箭头方向不完整的边。",
				"图中大三上至大三下、以及大三下至大四之间存在蓝色空心大箭头，但未明确连接到具体课程节点，故未输出为课程边。",
				"“专业选修课程”“行业领域协同课程”在多个学期重复出现，节点按各自学期分别保留。",
				"部分连线在裁切处或与其他线重叠，只有箭头方向清晰可见者被保留。",
				"至少有一个检测到的课程地图区域标题不够清晰。"
			],
			imageSrc: "/course-maps/数字经济本科人才培养方案/page-0257-page-0257-block-mineru-block-0006-0006-map-01.png",
			nodes: [
				{
					node_label: "高数（二）",
					stage_label: "大一下",
					category_label: "",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "统计学",
					stage_label: "大一下",
					category_label: "",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "中级微观经济学",
					stage_label: "大一下",
					category_label: "",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "数字经济概论",
					stage_label: "大一下",
					category_label: "",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 2
				},
				{
					node_label: "Python程序设计",
					stage_label: "大一下",
					category_label: "",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "概率论",
					stage_label: "大二上",
					category_label: "",
					route_group: "foundation",
					incoming_count: 1,
					outgoing_count: 1
				},
				{
					node_label: "中级宏观经济学",
					stage_label: "大二上",
					category_label: "",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 1
				},
				{
					node_label: "金融学",
					stage_label: "大二上",
					category_label: "",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 1
				},
				{
					node_label: "专业选修课程",
					stage_label: "大二上",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "数据获取与知识发现",
					stage_label: "大二上",
					category_label: "",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 1
				},
				{
					node_label: "计量经济学",
					stage_label: "大二下",
					category_label: "",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "财政学",
					stage_label: "大二下",
					category_label: "",
					route_group: "core",
					incoming_count: 2,
					outgoing_count: 0
				},
				{
					node_label: "专业选修课程",
					stage_label: "大二下",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "机器学习与人工智能",
					stage_label: "大二下",
					category_label: "",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 1
				},
				{
					node_label: "动态规划与最优控制",
					stage_label: "大三上",
					category_label: "",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "行业领域协同课程",
					stage_label: "大三上",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "国际经济学",
					stage_label: "大三上",
					category_label: "",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "博弈论与信息经济学",
					stage_label: "大三上",
					category_label: "",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "专业选修课程",
					stage_label: "大三上",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "跨学科交叉课程",
					stage_label: "大三下",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "行业领域协同课程",
					stage_label: "大三下",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "全球胜任力培养",
					stage_label: "大三下",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "网络与平台经济学",
					stage_label: "大三下",
					category_label: "",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "专业选修课程",
					stage_label: "大三下",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "本硕贯通课程",
					stage_label: "大四",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "毕业论文",
					stage_label: "大四",
					category_label: "",
					route_group: "practice",
					incoming_count: 0,
					outgoing_count: 0
				}
			],
			edges: [
				{
					source_label: "高数（二）",
					target_label: "概率论"
				},
				{
					source_label: "中级微观经济学",
					target_label: "中级宏观经济学"
				},
				{
					source_label: "数字经济概论",
					target_label: "金融学"
				},
				{
					source_label: "Python程序设计",
					target_label: "数据获取与知识发现"
				},
				{
					source_label: "概率论",
					target_label: "计量经济学"
				},
				{
					source_label: "中级宏观经济学",
					target_label: "财政学"
				},
				{
					source_label: "金融学",
					target_label: "财政学"
				},
				{
					source_label: "数据获取与知识发现",
					target_label: "机器学习与人工智能"
				},
				{
					source_label: "动态规划与最优控制",
					target_label: "国际经济学"
				},
				{
					source_label: "数字经济概论",
					target_label: "博弈论与信息经济学"
				},
				{
					source_label: "机器学习与人工智能",
					target_label: "网络与平台经济学"
				}
			]
		}
	]
} as const;

export default data;
