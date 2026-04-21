export interface NoticeTypeConfig {
  type: string;
  name: string;
  enabled: boolean;
  incrementalPages: number;
  incrementalPageSize: number;
  backfillPages: number;
  backfillPageSize: number;
}

export interface NoticeTypePolicySnapshot {
  type: string;
  name: string;
  enabled: boolean;
  incremental: {
    pages: number;
    page_size: number;
  };
  backfill: {
    pages: number;
    page_size: number;
  };
}

export interface NoticeItem {
  notice_id?: number;
  notice_type?: number | string;
  notice_type_name?: string;
  notice_title?: string;
  organization_name?: string;
  organization_id?: string;
  notice_release_time?: string;
  notice_create_time?: string;
  notice_first_time?: string;
  notice_content?: string;
  notice_link?: string;
  notice_source?: number;
  notice_link_state?: number;
  notice_state?: number;
  notice_stick?: number;
}

export interface NoticePage {
  totalCounts?: number;
}

export interface NoticeListResponse {
  state?: boolean;
  msg?: string;
  datas?: {
    tables?: NoticeItem[];
    page?: NoticePage;
  };
}

export interface NoticeSelectOrganizationRecord {
  organization_id?: string | null;
  organization_name?: string | null;
}

export interface NoticeSelectTypeRecord {
  notice_type_id?: number | string | null;
  notice_type_name?: string | null;
}

export interface NoticeSelectsResponse {
  state?: boolean;
  msg?: string;
  datas?: {
    org?: NoticeSelectOrganizationRecord[];
    type?: NoticeSelectTypeRecord[];
  };
}

export interface NoticeDetailInfo {
  notice_title?: string | null;
  notice_state?: number | null;
  notice_source?: number | null;
  notice_link_state?: number | null;
  notice_content?: string | null;
  notice_link?: string | null;
  notice_type_name?: string | null;
  home_url?: string | null;
  user_name?: string | null;
  organization_name?: string | null;
  organization_id?: string | null;
  collect_state?: number | null;
  notice_id?: number | null;
  notice_release_time?: string | null;
  notice_create_time?: string | null;
  notice_first_time?: string | null;
  notice_stick?: number | null;
  notice_annext?: NoticeAnnexInfo[] | null;
}

export interface NoticeAnnexInfo {
  notice_annex_path?: string | null;
  notice_annex_id?: string | null;
  notice_annex_name?: string | null;
  suffix?: string | null;
  type?: string | null;
}

export interface NoticeDetailResponse {
  state?: boolean;
  msg?: string;
  datas?: {
    notice_info?: NoticeDetailInfo | null;
  };
}

export interface NoticeCategoryRecord {
  notice_id: number;
  notice_type: string;
  notice_type_name: string | null;
  category_first_seen_at: string;
  category_last_seen_at: string;
  category_last_run_id: number | null;
}

export interface BundleLinkObservation {
  id: number;
  notice_id: number;
  run_id: number | null;
  source: "content";
  content_kind: "body_link" | "attachment_list";
  url: string;
  url_scheme: string | null;
  link_host: string | null;
  link_scope: "internal" | "external" | "unsupported";
  collect_policy: "reference_only" | "skip_scheme";
  skip_reason: "unsupported_scheme" | null;
  link_text: string | null;
  final_url: string | null;
  title: string | null;
  status_code: number | null;
  content_type: string | null;
  downloaded: boolean;
  download_path: string | null;
  file_size: number | null;
  fetched_at: string;
  error_message: string | null;
}

export interface BundleNoticeAttachmentRelation {
  notice_id: number;
  attachment_id: number;
  link_id: number | null;
  relation_source: "content" | "detail_api";
  resource_role: "attachment";
  anchor_text: string | null;
  discovered_at: string;
}

export interface BundleAttachmentObservation {
  attachment_id: number;
  source_url: string;
  normalized_source_url: string;
  final_url: string | null;
  original_filename: string | null;
  mime_type: string | null;
  byte_size: number | null;
  sha256: string | null;
  storage_provider: "reference_only" | "object_store" | "local";
  bucket: string | null;
  object_key: string | null;
  etag: string | null;
  version_id: string | null;
  origin_url_scheme: string | null;
  origin_host: string | null;
  origin_scope: "internal" | "external" | "unsupported";
  provenance_status: "reference_only" | "collected_internal";
  ingest_status: "reference_only" | "downloaded" | "uploaded";
  local_path: string | null;
  downloaded_at: string | null;
  uploaded_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface BundleNoticePayload {
  notice_id: number;
  notice_title: string;
  organization_name: string | null;
  organization_id: string | null;
  notice_release_time: string | null;
  notice_create_time: string | null;
  notice_first_time: string | null;
  notice_content: string | null;
  notice_link: string | null;
  notice_source: number | null;
  notice_link_state: number | null;
  notice_state: number | null;
  notice_stick: number | null;
  categories: NoticeCategoryRecord[];
  last_seen_at: string;
  enrich_attempted_at: string;
}

export interface BundleNoticeRecord {
  notice_id: number;
  notice: BundleNoticePayload;
  links: BundleLinkObservation[];
  notice_attachments: BundleNoticeAttachmentRelation[];
  attachments: BundleAttachmentObservation[];
}

export interface CollectorExportMetadata {
  runtime_shell: "repo_local_node";
  export_contract_version: "authenticated_notice_collector_export_v2";
  link_collection_mode: "html_reference_only";
  attachment_collection_mode:
    | "detail_api_and_html_reference_only"
    | "detail_api_and_html_materialized";
  attachment_storage_mode: "reference_only" | "object_store_write";
}

export interface FileReleaseDepartmentRecord {
  filedepartment?: string | null;
}

export interface FileReleaseListItem {
  id?: number | string | null;
  filename?: string | null;
  filecode?: string | null;
  filetime?: string | null;
  filedepartment?: string | null;
  typename?: string | null;
  user_name?: string | null;
  explainDept?: string | null;
  fileurl?: string | null;
}

export interface FileReleasePageResponse {
  state?: boolean;
  sync?: boolean;
  size?: number;
  dws?: FileReleaseDepartmentRecord[];
  data?: FileReleaseListItem[];
}

export interface FileReleaseDetailResponse {
  id?: number | string | null;
  filename?: string | null;
  filecode?: string | null;
  fileurl?: string | null;
  filetime?: string | null;
  state?: number | boolean | null;
  filedepartment?: string | null;
  gh?: string | null;
  filetypeid?: number | string | null;
  upfilename?: string | null;
  important?: number | null;
  detImportant?: number | null;
  needSync?: number | null;
  explainDept?: string | null;
  role?: number | null;
}

export interface FileReleaseDownloadUrlResponse {
  state?: boolean;
  url?: string | null;
}

export interface FileReleaseTypeRecord {
  id?: number | string | null;
  typename?: string | null;
  sort?: number | string | null;
}

export interface FileReleaseTypeListResponse {
  state?: boolean;
  data?: FileReleaseTypeRecord[];
}

export interface FileReleaseExplainDepartmentRecord {
  ORGANIZATION_NAME?: string | null;
}

export interface FileReleaseExplainDepartmentListResponse {
  state?: boolean;
  data?: FileReleaseExplainDepartmentRecord[];
}

export interface FileReleaseCodeTypeRecord {
  id?: number | string | null;
  name?: string | null;
  sort?: number | string | null;
}

export interface FileReleaseCodeTypeListResponse {
  state?: boolean;
  data?: FileReleaseCodeTypeRecord[];
}

export interface BundleReleasedFileObservation {
  source_url: string;
  normalized_source_url: string;
  final_url: string | null;
  original_filename: string | null;
  mime_type: string | null;
  byte_size: number | null;
  sha256: string | null;
  storage_provider: "reference_only" | "object_store" | "local";
  bucket: string | null;
  object_key: string | null;
  etag: string | null;
  version_id: string | null;
  origin_url_scheme: string | null;
  origin_host: string | null;
  origin_scope: "internal" | "external" | "unsupported";
  provenance_status: "reference_only" | "collected_internal";
  ingest_status: "reference_only" | "downloaded" | "uploaded";
  local_path: string | null;
  downloaded_at: string | null;
  uploaded_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface BundleFileReleasePayload {
  source_surface: "file_release";
  filename: string;
  filecode: string | null;
  filetime: string | null;
  filedepartment: string | null;
  explain_department: string | null;
  publisher_user_name: string | null;
  file_type_id: number | null;
  file_type_name: string | null;
  original_portal_file_url: string | null;
  resolved_download_url: string | null;
  upfilename: string | null;
  important: number | null;
  det_important: number | null;
  role: number | null;
  last_seen_at: string;
  enrich_attempted_at: string;
}

export interface BundleFileReleaseRecord {
  file_release_id: number;
  file_release: BundleFileReleasePayload;
  released_file: BundleReleasedFileObservation;
}

export interface CollectorFileReleaseExportMetadata {
  runtime_shell: "repo_local_node";
  export_contract_version: "authenticated_notice_file_release_export_v1";
  file_release_collection_mode:
    | "prompt_portlet_reference_only"
    | "prompt_portlet_materialized";
  file_storage_mode: "reference_only" | "object_store_write";
}

export interface FileReleaseExportManifest {
  schema_version: "authenticated_notice_file_release_export_v1";
  exported_at: string;
  export_date: string;
  export_scope: string;
  source_channel: "authenticated_notice_portal";
  source_surface: "file_release";
  site_id: string;
  source_home_url: string;
  collector: CollectorFileReleaseExportMetadata;
  filters: {
    page_size: number;
    max_pages: number | null;
    max_file_releases: number | null;
    target_file_release_id: number | null;
  };
  observed_file_types: Array<{
    id: number;
    typename: string;
    sort: number | null;
  }>;
  observed_departments: string[];
  observed_file_code_types: Array<{
    id: number;
    name: string;
    sort: number | null;
  }>;
  observed_explain_departments: string[];
  run: {
    mode: "file_release_export";
    status: "success";
    started_at: string;
    finished_at: string;
    pages_fetched: number;
    items_seen: number;
    items_inserted: number;
    detail_fetched: number;
    file_urls_resolved: number;
    errors: number;
  };
}

export interface BootstrapExportManifest {
  schema_version: string;
  exported_at: string;
  export_date: string;
  export_scope: string;
  source_channel: "authenticated_notice_portal";
  site_id: string;
  source_home_url: string;
  collector: CollectorExportMetadata;
  filters: {
    notice_types: string[];
    max_notices: number | null;
  };
  notice_type_policy: NoticeTypePolicySnapshot[];
  observed_notice_types: Array<{
    notice_type_id: number;
    notice_type_name: string;
  }>;
  observed_organizations: Array<{
    organization_id: string;
    organization_name: string;
  }>;
  run: {
    mode: "bootstrap_export";
    status: "success";
    started_at: string;
    finished_at: string;
    pages_fetched: number;
    items_seen: number;
    items_inserted: number;
    detail_fetched: number;
    errors: number;
  };
}

export interface ApiResponseLike {
  body?(): Promise<Buffer>;
  headers?(): Record<string, string>;
  json(): Promise<unknown>;
  ok(): boolean;
  status(): number;
  statusText(): string;
  text?(): Promise<string>;
}

export interface ApiRequestContextLike {
  get(
    path: string,
  ): Promise<ApiResponseLike>;
  post(
    path: string,
    input: {
      form: Record<string, string>;
    },
  ): Promise<ApiResponseLike>;
}

export interface DisposableApiContextLike {
  dispose(): Promise<void>;
}
