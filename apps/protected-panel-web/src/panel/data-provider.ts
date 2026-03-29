import {
  HttpError,
  type DataProvider,
  type DeleteManyParams,
  type DeleteParams,
  type GetListParams,
  type GetListResult,
  type GetManyParams,
  type GetManyResult,
  type GetManyReferenceParams,
  type GetOneParams,
  type GetOneResult,
  type Identifier,
  type QueryFunctionContext,
  type RaRecord,
  type UpdateManyParams,
  type UpdateParams,
} from "react-admin";

import { fetchJson } from "./http";
import {
  normalizeOfficialWebRunRecord,
  normalizeOfficialWebSiteDetailRecord,
  normalizeOfficialWebSiteRecord,
  normalizeOverviewRecord,
  normalizeRequestRecord,
  type OfficialWebRunRecord,
  type OfficialWebSiteRecord,
  type PanelOverviewRecord,
  type RawOfficialWebRunDetailResponse,
  type RawOfficialWebRunListResponse,
  type RawOfficialWebSiteDetailResponse,
  type RawOfficialWebSiteListResponse,
  type RawPanelOverviewResponse,
  type RawRequestDetailResponse,
  type RawRequestListResponse,
  type RequestProjectionRecord,
} from "./types";

export interface ProtectedPanelDataProvider extends DataProvider {
  getOverview(input?: { signal?: AbortSignal }): Promise<{ data: PanelOverviewRecord }>;
}

const requestPageCursors = new Map<string, Map<number, string | null>>();

function unsupportedMethod(resource: string, method: string): never {
  throw new HttpError(`${resource}.${method} is not implemented in protected-panel-web.`, 405, {
    error: {
      code: "not_implemented",
      message: `${resource}.${method} is not implemented in protected-panel-web.`,
    },
  });
}

function normalizeFilterValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildCursorKey(input: {
  resource: string;
  filter: GetListParams["filter"];
  perPage: number;
}) {
  const entries = Object.entries(input.filter ?? {})
    .map(([key, value]) => [key, normalizeFilterValue(value)] as const)
    .filter(([, value]) => Boolean(value))
    .sort(([left], [right]) => left.localeCompare(right));

  return JSON.stringify({
    entries,
    perPage: input.perPage,
    resource: input.resource,
  });
}

function getCursorHistory(cursorKey: string) {
  let history = requestPageCursors.get(cursorKey);
  if (!history) {
    history = new Map<number, string | null>([[1, null]]);
    requestPageCursors.set(cursorKey, history);
  }

  return history;
}

function pruneCursorHistory(history: Map<number, string | null>, currentPage: number) {
  for (const knownPage of [...history.keys()]) {
    if (knownPage > currentPage) {
      history.delete(knownPage);
    }
  }
}

function appendRequestFilters(query: URLSearchParams, filter: GetListParams["filter"]) {
  const requestId = normalizeFilterValue(filter?.requestId);
  const conversationId = normalizeFilterValue(filter?.conversationId);
  const status = normalizeFilterValue(filter?.status);
  const surface = normalizeFilterValue(filter?.surface);

  if (requestId) {
    query.set("requestId", requestId);
  }
  if (conversationId) {
    query.set("conversationId", conversationId);
  }
  if (status) {
    query.set("status", status);
  }
  if (surface) {
    query.set("surface", surface);
  }
}

async function getRequestList(
  params: GetListParams,
): Promise<{
  data: RequestProjectionRecord[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}> {
  const perPage = params.pagination?.perPage ?? 20;
  const page = params.pagination?.page ?? 1;
  const cursorKey = buildCursorKey({ filter: params.filter, perPage, resource: "requests" });
  const cursorHistory = getCursorHistory(cursorKey);

  if (page > 1 && !cursorHistory.has(page)) {
    throw new HttpError(
      "Protected panel request pagination currently supports sequential next-page navigation only.",
      400,
      {
        error: {
          code: "cursor_not_available",
          message:
            "Protected panel request pagination currently supports sequential next-page navigation only.",
        },
      },
    );
  }

  const query = new URLSearchParams();
  query.set("limit", String(perPage));
  appendRequestFilters(query, params.filter);

  const cursor = cursorHistory.get(page);
  if (cursor) {
    query.set("cursor", cursor);
  }

  const payload = await fetchJson<RawRequestListResponse>(`/api/requests?${query.toString()}`, {
    signal: params.signal,
  });
  pruneCursorHistory(cursorHistory, page);
  if (payload.page.nextCursor) {
    cursorHistory.set(page + 1, payload.page.nextCursor);
  }

  return {
    data: payload.requests.map(normalizeRequestRecord),
    pageInfo: {
      hasNextPage: Boolean(payload.page.nextCursor),
      hasPreviousPage: page > 1,
    },
  };
}

function appendOfficialWebRunFilters(query: URLSearchParams, filter: GetListParams["filter"]) {
  const siteId = normalizeFilterValue(filter?.siteId);
  const status = normalizeFilterValue(filter?.status);
  const ingestionDispatchStatus = normalizeFilterValue(filter?.ingestionDispatchStatus);

  if (siteId) {
    query.set("siteId", siteId);
  }
  if (status) {
    query.set("status", status);
  }
  if (ingestionDispatchStatus) {
    query.set("ingestionDispatchStatus", ingestionDispatchStatus);
  }
}

async function getOfficialWebRunList(
  params: GetListParams,
): Promise<{
  data: OfficialWebRunRecord[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}> {
  const perPage = params.pagination?.perPage ?? 20;
  const page = params.pagination?.page ?? 1;
  const cursorKey = buildCursorKey({
    filter: params.filter,
    perPage,
    resource: "officialWebRuns",
  });
  const cursorHistory = getCursorHistory(cursorKey);

  if (page > 1 && !cursorHistory.has(page)) {
    throw new HttpError(
      "Protected panel official web pagination currently supports sequential next-page navigation only.",
      400,
      {
        error: {
          code: "cursor_not_available",
          message:
            "Protected panel official web pagination currently supports sequential next-page navigation only.",
        },
      },
    );
  }

  const query = new URLSearchParams();
  query.set("limit", String(perPage));
  appendOfficialWebRunFilters(query, params.filter);

  const cursor = cursorHistory.get(page);
  if (cursor) {
    query.set("cursor", cursor);
  }

  const payload = await fetchJson<RawOfficialWebRunListResponse>(
    `/api/official-web/runs?${query.toString()}`,
    {
      signal: params.signal,
    },
  );
  pruneCursorHistory(cursorHistory, page);
  if (payload.page.nextCursor) {
    cursorHistory.set(page + 1, payload.page.nextCursor);
  }

  return {
    data: payload.runs.map(normalizeOfficialWebRunRecord),
    pageInfo: {
      hasNextPage: Boolean(payload.page.nextCursor),
      hasPreviousPage: page > 1,
    },
  };
}

async function getOfficialWebRunDetail(
  id: Identifier,
  signal?: AbortSignal,
): Promise<{ data: OfficialWebRunRecord }> {
  const payload = await fetchJson<RawOfficialWebRunDetailResponse>(`/api/official-web/runs/${id}`, {
    signal,
  });

  return {
    data: normalizeOfficialWebRunRecord(payload.run),
  };
}

async function getOfficialWebSiteList(
  signal?: AbortSignal,
): Promise<{
  data: OfficialWebSiteRecord[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}> {
  const payload = await fetchJson<RawOfficialWebSiteListResponse>("/api/official-web/sites", {
    signal,
  });

  return {
    data: payload.sites.map(normalizeOfficialWebSiteRecord),
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
}

async function getOfficialWebSiteDetail(
  id: Identifier,
  signal?: AbortSignal,
): Promise<{ data: OfficialWebSiteRecord }> {
  const payload = await fetchJson<RawOfficialWebSiteDetailResponse>(`/api/official-web/sites/${id}`, {
    signal,
  });

  return {
    data: normalizeOfficialWebSiteDetailRecord(payload),
  };
}

async function getRequestDetail(
  id: Identifier,
  signal?: AbortSignal,
): Promise<{ data: RequestProjectionRecord }> {
  const payload = await fetchJson<RawRequestDetailResponse>(`/api/requests/${id}`, {
    signal,
  });

  return {
    data: normalizeRequestRecord(payload.request),
  };
}

export const protectedPanelDataProvider: ProtectedPanelDataProvider = {
  async create(resource) {
    unsupportedMethod(resource, "create");
  },
  async delete(resource, _params?: DeleteParams) {
    unsupportedMethod(resource, "delete");
  },
  async deleteMany(resource, _params?: DeleteManyParams) {
    unsupportedMethod(resource, "deleteMany");
  },
  async getList<RecordType extends RaRecord = RequestProjectionRecord>(
    resource: string,
    params: GetListParams & QueryFunctionContext,
  ): Promise<GetListResult<RecordType>> {
    if (resource === "requests") {
      return (await getRequestList(params)) as unknown as GetListResult<RecordType>;
    }
    if (resource === "officialWebRuns") {
      return (await getOfficialWebRunList(params)) as unknown as GetListResult<RecordType>;
    }
    if (resource === "officialWebSites") {
      return (await getOfficialWebSiteList(params.signal)) as unknown as GetListResult<RecordType>;
    }

    unsupportedMethod(resource, "getList");
  },
  async getMany<RecordType extends RaRecord = RequestProjectionRecord>(
    resource: string,
    params: GetManyParams<RecordType> & QueryFunctionContext,
  ): Promise<GetManyResult<RecordType>> {
    if (resource === "requests") {
      const items = await Promise.all(
        params.ids.map((id) => getRequestDetail(id, params.signal).then((result) => result.data)),
      );

      return {
        data: items,
      } as unknown as GetManyResult<RecordType>;
    }
    if (resource === "officialWebRuns") {
      const items = await Promise.all(
        params.ids.map((id) => getOfficialWebRunDetail(id, params.signal).then((result) => result.data)),
      );

      return {
        data: items,
      } as unknown as GetManyResult<RecordType>;
    }
    if (resource === "officialWebSites") {
      const items = await Promise.all(
        params.ids.map((id) => getOfficialWebSiteDetail(id, params.signal).then((result) => result.data)),
      );

      return {
        data: items,
      } as unknown as GetManyResult<RecordType>;
    }

    unsupportedMethod(resource, "getMany");
  },
  async getManyReference(resource, _params?: GetManyReferenceParams) {
    unsupportedMethod(resource, "getManyReference");
  },
  async getOne<RecordType extends RaRecord = RequestProjectionRecord>(
    resource: string,
    params: GetOneParams<RecordType> & QueryFunctionContext,
  ): Promise<GetOneResult<RecordType>> {
    if (resource === "requests") {
      return (await getRequestDetail(params.id, params.signal)) as unknown as GetOneResult<RecordType>;
    }
    if (resource === "officialWebRuns") {
      return (await getOfficialWebRunDetail(params.id, params.signal)) as unknown as GetOneResult<RecordType>;
    }
    if (resource === "officialWebSites") {
      return (await getOfficialWebSiteDetail(params.id, params.signal)) as unknown as GetOneResult<RecordType>;
    }

    unsupportedMethod(resource, "getOne");
  },
  async getOverview(input) {
    const payload = await fetchJson<RawPanelOverviewResponse>("/api/overview", {
      signal: input?.signal,
    });

    return {
      data: normalizeOverviewRecord(payload),
    };
  },
  async update(resource, _params?: UpdateParams) {
    unsupportedMethod(resource, "update");
  },
  async updateMany(resource, _params?: UpdateManyParams) {
    unsupportedMethod(resource, "updateMany");
  },
};
