const data = {
	generatedAt: "2026-04-22T22:51:03.970394+00:00",
	documentTitle: "国际经济与贸易本科人才培养方案",
	documentId: "curriculum:国际经济与贸易本科人才培养方案",
	rawAssetId: "asset:curriculum-plan-2022",
	rawVersionId: "sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67",
	blocks: [
		{
			blockId: "page-0287-page-0287-block-mineru-block-0002-0002-map-01",
			title: "国际经济与贸易专业本科课程结构拓扑图",
			status: "partial",
			titleConfidence: "partial",
			pageNumber: 287,
			rowId: "page-0287-block-mineru-block-0002-0002",
			mapIndex: 1,
			parentHeadingHint: "六、课程地图",
			displayStageLabels: [
				"本科一年级",
				"本科二年级",
				"本科三年级",
				"本科四年级"
			],
			extractionNotes: [
				"当前裁切区域仅识别到 1 张完整课程地图，未拆分出更多独立子图。",
				"图中本科三年级右侧与本科四年级大部分课程未完整出现在裁剪区域内，未纳入。",
				"仅保留箭头方向清晰可见的连线；管理学与其他专业选修课之间仅见折线经过，未见明确箭头，故未输出。",
				"‘国际商务英语’下方有竖线连接到‘国际贸易实务’，但未见明确箭头，未输出。",
				"‘会计学’与‘管理学’之间为短线但未见明确箭头，未输出。",
				"至少有一个检测到的课程地图区域标题不够清晰。"
			],
			imageSrc: "/course-maps/国际经济与贸易本科人才培养方案/page-0287-page-0287-block-mineru-block-0002-0002-map-01.png",
			nodes: [
				{
					node_label: "通识课",
					stage_label: "本科一年级",
					category_label: "通识课",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "政治经济学（资）",
					stage_label: "本科一年级",
					category_label: "学科基础课",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "政治经济学（社）",
					stage_label: "本科一年级",
					category_label: "学科基础课",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "微观经济学",
					stage_label: "本科一年级",
					category_label: "学科基础课",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 2
				},
				{
					node_label: "经济学说史",
					stage_label: "本科一年级",
					category_label: "专业选修课",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "跨学科交叉课程",
					stage_label: "本科一年级",
					category_label: "个性化课程",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "会计学",
					stage_label: "本科一年级",
					category_label: "学科基础课",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "管理学",
					stage_label: "本科一年级",
					category_label: "专业选修课",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "其他专业选修课",
					stage_label: "本科一年级",
					category_label: "专业选修课",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "通识课",
					stage_label: "本科二年级",
					category_label: "通识课",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "宏观经济学",
					stage_label: "本科二年级",
					category_label: "学科基础课",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 1
				},
				{
					node_label: "统计学",
					stage_label: "本科二年级",
					category_label: "学科基础课",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "财政学",
					stage_label: "本科二年级",
					category_label: "学科基础课",
					route_group: "core",
					incoming_count: 2,
					outgoing_count: 0
				},
				{
					node_label: "金融学",
					stage_label: "本科二年级",
					category_label: "学科基础课",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "国际经济学",
					stage_label: "本科二年级",
					category_label: "学科基础课",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 2
				},
				{
					node_label: "国际贸易概论",
					stage_label: "本科二年级",
					category_label: "专业选修课",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 2
				},
				{
					node_label: "国际金融",
					stage_label: "本科二年级",
					category_label: "专业核心课",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "数字贸易",
					stage_label: "本科二年级",
					category_label: "专业核心课",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "国际商务英语",
					stage_label: "本科二年级",
					category_label: "专业核心课",
					route_group: "foundation",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "国际贸易实务",
					stage_label: "本科二年级",
					category_label: "专业核心课",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 2
				},
				{
					node_label: "国际市场营销",
					stage_label: "本科二年级",
					category_label: "专业选修课",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "其他专业选修课",
					stage_label: "本科二年级",
					category_label: "专业选修课",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "跨学科交叉课程",
					stage_label: "本科三年级",
					category_label: "个性化课程",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "计量经济学",
					stage_label: "本科三年级",
					category_label: "专业核心课",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "世界经济",
					stage_label: "本科三年级",
					category_label: "专业核心课",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "中国开放型经济学",
					stage_label: "本科三年级",
					category_label: "专业选修课",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "中国对外贸易概论",
					stage_label: "本科三年级",
					category_label: "专业选修课",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "国际商法",
					stage_label: "本科三年级",
					category_label: "专业核心课",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "国际结算",
					stage_label: "本科三年级",
					category_label: "专业核心课",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "国际投资",
					stage_label: "本科三年级",
					category_label: "专业核心课",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "国际商务沟通",
					stage_label: "本科三年级",
					category_label: "专业选修课",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 0
				}
			],
			edges: [
				{
					source_label: "政治经济学（资）",
					target_label: "政治经济学（社）"
				},
				{
					source_label: "经济学说史",
					target_label: "微观经济学"
				},
				{
					source_label: "微观经济学",
					target_label: "宏观经济学"
				},
				{
					source_label: "微观经济学",
					target_label: "财政学"
				},
				{
					source_label: "宏观经济学",
					target_label: "财政学"
				},
				{
					source_label: "国际贸易概论",
					target_label: "国际经济学"
				},
				{
					source_label: "国际贸易概论",
					target_label: "国际贸易实务"
				},
				{
					source_label: "国际经济学",
					target_label: "国际金融"
				},
				{
					source_label: "国际经济学",
					target_label: "数字贸易"
				},
				{
					source_label: "统计学",
					target_label: "计量经济学"
				},
				{
					source_label: "中国开放型经济学",
					target_label: "中国对外贸易概论"
				},
				{
					source_label: "国际贸易实务",
					target_label: "国际商法"
				},
				{
					source_label: "国际贸易实务",
					target_label: "国际结算"
				},
				{
					source_label: "管理学",
					target_label: "国际市场营销"
				}
			]
		}
	]
} as const;

export default data;
