export const PANEL_COPY = {
  appTitle: "校园助理运维面板",
  loadingPage: "正在加载面板页面...",
  rootElementMissing: "未找到面板根节点。",
  view: "查看",
  yes: "是",
  no: "否",
  unknown: "未知",
  none: "无",
  pending: "处理中",
  notAvailable: "暂无",
  unspecified: "未指定",
  notSet: "未设置",
  notProvided: "未提供",
  notAttached: "未关联",
  notSelected: "未选择",
  unnamedPrincipal: "未命名主体",
  noGroupsProjected: "未投影任何分组",
  noSourceDocumentsCaptured: "未记录来源文档",
  noRuns: "暂无运行记录",
  noRecentRuns: "暂无最近运行记录",
  workerServiceBinding: "通过 Worker service binding 绑定",
  menu: {
    overview: "总览",
    requests: "请求",
    officialWebSites: "官网站点",
    officialWebRuns: "采集运行",
    jobs: "任务",
    operations: "操作",
    audit: "审计",
  },
  appBar: {
    account: "运维账号",
    closeMenu: "收起导航菜单",
    openMenu: "打开导航菜单",
    refresh: "刷新",
    switchToDarkMode: "切换为深色主题",
    switchToLightMode: "切换为浅色主题",
    logout: "退出当前会话",
  },
  actions: {
    columnSettings: "列设置",
    export: "导出",
  },
  requestsList: {
    title: "请求分诊台",
    summary: "先按状态和搜索收敛，再进入详情页查看观测、审计与深度诊断。",
    intro: "请求列表读取 app-api 维护的请求投影视图，不会回放回答运行时，也不会直接检查原始日志。",
    paginationHint: "分页依赖游标链路，请按顺序向后翻页；如果游标链缺失，直接跳页会按 fail-closed 处理。",
    projectionLagHint: "新完成的聊天请求可能会延迟片刻出现，因为投影器需要先物化读模型。",
    searchLabel: "搜索请求",
    searchPlaceholder: "请求 ID / 问题 / 主体 / 错误码",
    allStatuses: "全部状态",
    conversationId: "会话 ID",
    noRequestsTitle: "暂无请求",
    noRequestsDescription:
      "此表只展示 app-api 已经物化完成的请求投影。刚被受理的聊天流量可能会短暂缺席，直到投影追上。",
    columns: {
      capability: "能力",
      conversationId: "会话 ID",
      duration: "耗时",
      outcome: "结果 / 异常",
      principal: "主体",
      question: "问题摘要",
      requestId: "请求 ID",
      scope: "目标 / 范围",
      startedAt: "开始时间",
      status: "状态",
      surface: "接入面",
      traceId: "Trace ID",
    },
    outcome: {
      accepted: "请求已受理，等待完成。",
      answerReady: "已生成回答",
      completedWithoutPreview: "回答已完成，但未记录预览。",
      noDetail: "暂无结果摘要。",
      noSourceDocuments: "无来源文档",
      rejected: "请求已被拒绝。",
    },
  },
  emptyState: {
    officialWebRuns: "暂无官网采集运行。",
    officialWebSites: "暂无官网站点。",
  },
  domainStatus: {
    blocked: "阻塞",
    deferred: "延后",
    ready: "就绪",
  },
  overviewDomains: {
    audit: "审计",
    jobs: "任务",
    official_web: "官网采集",
    operations: "操作",
    overview: "总览",
    requests: "请求",
  },
  requestStatus: {
    accepted: "已受理",
    approval_required: "待审批",
    completed: "已完成",
    error: "错误",
    needs_clarification: "待澄清",
    no_answer: "无法回答",
    rejected: "已拒绝",
  },
  officialWebStatus: {
    abandoned: "已放弃",
    accepted: "已受理",
    completed: "已完成",
    completed_with_errors: "完成但有错误",
    failed: "失败",
    running: "运行中",
  },
  ingestionStatus: {
    dispatched: "已分发",
    ingestion_failed: "分发失败",
    pending: "待处理",
    queued: "已排队",
  },
  pagination: {
    rowsPerPage: "每页条数",
    goToFirstPage: "前往第一页",
    goToLastPage: "前往最后一页",
    goToNextPage: "前往下一页",
    goToPreviousPage: "前往上一页",
  },
  sort: {
    ascending: "升序",
    descending: "降序",
  },
  errorState: {
    listLoadFailed: "当前列表读取失败，请稍后重试。",
  },
} as const;

const RUNTIME_ERROR_MESSAGES: Record<string, string> = {
  access_reentry_required: "当前受保护访问会话已失效，请重新进入面板。",
  cursor_not_available: "当前分页游标不可用，请按顺序逐页浏览。",
  dependency_not_ready: "面板运行时依赖尚未就绪。",
  forbidden: "当前身份没有运维面板访问权限。",
  frontend_assets_not_ready: "面板前端资源尚未就绪。",
  internal_error: "app-api 当前返回了未预期错误，请稍后重试。",
  invalid_runtime_payload: "面板运行时返回了无效数据。",
  not_found: "未找到请求的资源。",
  operator_identity_required: "当前会话缺少可信运维身份，无法访问该受保护接口。",
};

export function formatPanelBoolean(value: boolean | null) {
  if (value === null) {
    return PANEL_COPY.unknown;
  }

  return value ? PANEL_COPY.yes : PANEL_COPY.no;
}

export function formatPanelMicrousd(value: number | null) {
  if (value === null) {
    return PANEL_COPY.unknown;
  }

  return `约 $${(value / 1_000_000).toFixed(4)} USD`;
}

export function formatPanelTimestamp(value: string | null) {
  if (!value) {
    return PANEL_COPY.pending;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

type PanelPaginationAriaTarget =
  | "end-ellipsis"
  | "first"
  | "last"
  | "next"
  | "page"
  | "previous"
  | "start-ellipsis";

export function formatPanelPaginationDisplayedRows(input: {
  count: number;
  from: number;
  to: number;
  hasNextPage: boolean;
}) {
  if (input.count === -1 && input.hasNextPage) {
    return `${input.from}-${input.to} / 超过 ${input.to}`;
  }

  return `${input.from}-${input.to} / ${input.count === -1 ? input.to : input.count}`;
}

export function formatPanelPaginationAriaLabel(input: {
  type: PanelPaginationAriaTarget;
  page?: number;
  selected?: boolean;
}) {
  if (input.type === "page" && typeof input.page === "number") {
    return input.selected ? `当前第 ${input.page} 页` : `前往第 ${input.page} 页`;
  }

  switch (input.type) {
    case "first":
      return PANEL_COPY.pagination.goToFirstPage;
    case "last":
      return PANEL_COPY.pagination.goToLastPage;
    case "next":
      return PANEL_COPY.pagination.goToNextPage;
    case "previous":
      return PANEL_COPY.pagination.goToPreviousPage;
    case "start-ellipsis":
    case "end-ellipsis":
      return "";
    default:
      return PANEL_COPY.unknown;
  }
}

export function formatPanelPageOutOfBoundaries(page: number) {
  return `页码 ${page} 超出范围。`;
}

export function formatPanelSortLabel(input: {
  fieldLabel?: string | null;
  order: "ASC" | "DESC";
}) {
  const normalizedFieldLabel = input.fieldLabel?.trim();
  const orderLabel = input.order === "DESC" ? PANEL_COPY.sort.descending : PANEL_COPY.sort.ascending;

  if (!normalizedFieldLabel) {
    return `排序（${orderLabel}）`;
  }

  return `按${normalizedFieldLabel}排序（${orderLabel}）`;
}

export function translateRuntimeErrorMessage(input: {
  code?: string | null;
  message?: string | null;
  statusText?: string;
}) {
  const code = input.code?.trim();
  if (code && RUNTIME_ERROR_MESSAGES[code]) {
    return RUNTIME_ERROR_MESSAGES[code];
  }

  const message = input.message?.trim();
  if (message) {
    return message;
  }

  return input.statusText?.trim() || "请求失败。";
}
