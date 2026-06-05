from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.ingestion.official_web_projection_test_support import (
    _block,
    _declarations_payload,
    _page_bundle_entry,
    _write_json,
    _write_output_page,
    replay_official_web_source_truth_local,
)


class OfficialWebProjectionDirectoryAndHashTestPart01(unittest.TestCase):
    def test_directory_projection_drops_section_tab_labels_from_first_directory_entry(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            payload = _declarations_payload()
            payload["declarations"].insert(
                3,
                {
                    "declaration_id": "directory-page-primary",
                    "page_family": "directory_page",
                    "target_corpus": "official_web",
                    "target_collection": "muc_public_pages",
                    "projection_family": "directory_document",
                    "document_kind": "directory",
                    "action": "emit_document",
                },
            )
            _write_json(declarations_path, payload)
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_directory_tabs_001",
                    "generatedAt": "2026-04-27T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_directory_tabs_001",
                            raw_version_id="owver_directory_tabs_001",
                            normalized_canonical_url="https://www.example.edu/zzjg/jxhkydw.htm",
                            page_family="directory_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_directory_tabs_001",
                raw_version_id="owver_directory_tabs_001",
                normalized_canonical_url="https://www.example.edu/zzjg/jxhkydw.htm",
                page_title="教学和科研单位",
                page_family="directory_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_directory_tabs_001",
                        raw_version_id="owver_directory_tabs_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="教学和科研单位",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_tabs_001",
                        raw_version_id="owver_directory_tabs_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="组织机构",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_tabs_001",
                        raw_version_id="owver_directory_tabs_001",
                        row_id="tab-1",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="职能部门",
                        parent_heading_path=["组织机构", "组织机构"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_tabs_001",
                        raw_version_id="owver_directory_tabs_001",
                        row_id="tab-2",
                        row_index=3,
                        block_order=3,
                        block_role="list_item",
                        text="校属机构",
                        parent_heading_path=["组织机构", "组织机构"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_tabs_001",
                        raw_version_id="owver_directory_tabs_001",
                        row_id="tab-3",
                        row_index=4,
                        block_order=4,
                        block_role="list_item",
                        text="教学和科研单位",
                        parent_heading_path=["组织机构", "组织机构"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_tabs_001",
                        raw_version_id="owver_directory_tabs_001",
                        row_id="entry-1",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="中华民族共同体学院",
                        parent_heading_path=["组织机构", "组织机构"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_tabs_001",
                        raw_version_id="owver_directory_tabs_001",
                        row_id="entry-2",
                        row_index=6,
                        block_order=6,
                        block_role="link",
                        text="民族学与社会学学院",
                        parent_heading_path=["组织机构", "组织机构", "中华民族共同体学院"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            units = [
                json.loads(line)
                for line in Path(report.documents[0]["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            self.assertEqual(units[0]["clean_text"], "中华民族共同体学院")
            self.assertEqual(units[0]["anchor"]["row_ids"], ["entry-1"])
            self.assertNotIn("职能部门", units[0]["clean_text"])
            self.assertNotIn("校属机构", units[0]["clean_text"])
            self.assertNotIn("教学和科研单位", units[0]["clean_text"])

    def test_directory_projection_drops_repeated_section_label_links_from_directory_entries(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            payload = _declarations_payload()
            payload["declarations"].insert(
                3,
                {
                    "declaration_id": "directory-page-primary",
                    "page_family": "directory_page",
                    "target_corpus": "official_web",
                    "target_collection": "muc_public_pages",
                    "projection_family": "directory_document",
                    "document_kind": "directory",
                    "action": "emit_document",
                },
            )
            _write_json(declarations_path, payload)
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_directory_repeated_label_001",
                    "generatedAt": "2026-04-27T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_directory_repeated_label_001",
                            raw_version_id="owver_directory_repeated_label_001",
                            normalized_canonical_url="https://xxgk.example.edu/gzzd.htm",
                            page_family="directory_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_directory_repeated_label_001",
                raw_version_id="owver_directory_repeated_label_001",
                normalized_canonical_url="https://xxgk.example.edu/gzzd.htm",
                page_title="规章制度",
                page_family="directory_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_directory_repeated_label_001",
                        raw_version_id="owver_directory_repeated_label_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="规章制度",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_repeated_label_001",
                        raw_version_id="owver_directory_repeated_label_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="规章制度",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_repeated_label_001",
                        raw_version_id="owver_directory_repeated_label_001",
                        row_id="label-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="规章制度",
                        parent_heading_path=["规章制度"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_repeated_label_001",
                        raw_version_id="owver_directory_repeated_label_001",
                        row_id="entry-1",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text="中央民族大学2023年工作要点",
                        parent_heading_path=["规章制度"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_repeated_label_001",
                        raw_version_id="owver_directory_repeated_label_001",
                        row_id="label-2",
                        row_index=4,
                        block_order=4,
                        block_role="link",
                        text="规章制度",
                        parent_heading_path=["规章制度"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_repeated_label_001",
                        raw_version_id="owver_directory_repeated_label_001",
                        row_id="entry-2",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="中央民族大学事业发展“十三五”规划",
                        parent_heading_path=["规章制度"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            units = [
                json.loads(line)
                for line in Path(report.documents[0]["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            self.assertEqual(
                units[0]["clean_text"],
                "中央民族大学2023年工作要点\n中央民族大学事业发展“十三五”规划",
            )
            self.assertEqual(units[0]["anchor"]["row_ids"], ["entry-1", "entry-2"])

    def test_directory_projection_drops_sidebar_label_stack_after_current_title_tab_cluster(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            payload = _declarations_payload()
            payload["declarations"].insert(
                3,
                {
                    "declaration_id": "directory-page-primary",
                    "page_family": "directory_page",
                    "target_corpus": "official_web",
                    "target_collection": "muc_public_pages",
                    "projection_family": "directory_document",
                    "document_kind": "directory",
                    "action": "emit_document",
                },
            )
            _write_json(declarations_path, payload)
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_directory_sidebar_001",
                    "generatedAt": "2026-04-27T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_directory_sidebar_001",
                            raw_version_id="owver_directory_sidebar_001",
                            normalized_canonical_url="https://www.example.edu/xxgk/xydt.htm",
                            page_family="directory_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_directory_sidebar_001",
                raw_version_id="owver_directory_sidebar_001",
                normalized_canonical_url="https://www.example.edu/xxgk/xydt.htm",
                page_title="校园地图",
                page_family="directory_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_directory_sidebar_001",
                        raw_version_id="owver_directory_sidebar_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="校园地图",
                    ),
                    *[
                        _block(
                            raw_asset_id="owasset_directory_sidebar_001",
                            raw_version_id="owver_directory_sidebar_001",
                            row_id=f"nav-{index}",
                            row_index=index,
                            block_order=index,
                            block_role="link",
                            text=text,
                            parent_heading_path=["学校概况"],
                        )
                        for index, text in enumerate(
                            [
                                "学校简介",
                                "现任领导",
                                "历任领导",
                                "学术名流",
                                "校园地图",
                                "标识系统 标志 中英文校名 校训 校旗 标准色 标志二级单位组合 标志规范手册",
                                "标识系统",
                                "标志",
                                "中英文校名",
                                "校训",
                                "校旗",
                                "标准色",
                                "标志二级单位组合",
                                "标志规范手册",
                            ],
                            start=1,
                        )
                    ],
                    _block(
                        raw_asset_id="owasset_directory_sidebar_001",
                        raw_version_id="owver_directory_sidebar_001",
                        row_id="entry-1",
                        row_index=20,
                        block_order=20,
                        block_role="paragraph",
                        text="海淀校区位于北京市海淀区中关村南大街27号。",
                        parent_heading_path=["校园地图"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            units = [
                json.loads(line)
                for line in Path(report.documents[0]["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            combined_text = "\n".join(unit["clean_text"] for unit in units)

            self.assertIn("海淀校区位于北京市海淀区中关村南大街27号。", combined_text)
            self.assertNotIn("标识系统 标志 中英文校名", combined_text)
            self.assertNotIn("标志规范手册", combined_text)
