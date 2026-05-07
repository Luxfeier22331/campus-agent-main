from __future__ import annotations

import unittest

from .official_web_projection_test_support import *


class OfficialWebProjectionAcademicCalendarTest(unittest.TestCase):
    def test_academic_calendar_candidate_extracts_teaching_week_and_makeup_arrangement(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            calendar_match = _target_match(
                consumer_family="academic_calendar_candidate",
                materialization_policy="candidate_only",
                selected_write_target="calendar/academic_calendar",
                target_id="official-web-academic-calendar",
                target_job_id="owtarget_academic_calendar",
                target_candidate_id="owcand_public_academic_calendar",
                target_label="中央民族大学公开校历",
            )
            _write_calendar_bundle(output_dir, calendar_match, "owrun_academic_calendar")
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_calendar",
                raw_version_id="owver_calendar",
                normalized_canonical_url="https://www.example.edu/calendar.htm",
                page_title="民大校历",
                page_family="article_detail",
                target_matches=[calendar_match],
                blocks=[
                    _calendar_block("title-1", 0, "title", "民大校历"),
                    _calendar_block("p-1", 1, "paragraph", "2025-2026学年春季学期教学安排。"),
                    _calendar_block("p-2", 2, "paragraph", "第10教学周：2026-05-04至2026-05-10。"),
                    _calendar_block("p-3", 3, "paragraph", "2026-05-01 至 2026-05-05 劳动节放假。"),
                    _calendar_block("p-3", 3, "paragraph", "2026-05-09 执行周一课表。"),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["consumer_candidate_pages"], 1)
            candidate = report.consumer_candidate_pages[0]
            self.assertEqual(candidate["consumer_family"], "academic_calendar_candidate")
            self.assertEqual(
                candidate["typed_candidate"]["academic_year_label"],
                "2025-2026学年",
            )
            self.assertEqual(candidate["typed_candidate"]["term_label"], "春季学期")
            self.assertEqual(candidate["typed_candidate"]["week_index"], 10)
            self.assertEqual(
                candidate["typed_candidate"]["class_day_pattern"],
                "执行周一课表",
            )
            holiday = next(
                record
                for record in candidate["typed_candidate"]["records"]
                if record["holiday_name"] == "劳动节假期"
            )
            self.assertEqual(holiday["record_family"], "named_event")
            self.assertEqual(holiday["event_end_date_exclusive"], "2026-05-06")
            self.assertEqual(candidate["quality_gate"], {"decision": "pass", "reason_codes": []})

    def test_academic_calendar_candidate_retains_image_evidence_without_structured_records(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            calendar_match = _target_match(
                consumer_family="academic_calendar_candidate",
                materialization_policy="candidate_only",
                selected_write_target="calendar/academic_calendar",
                target_id="official-web-academic-calendar",
                target_job_id="owtarget_academic_calendar",
                target_candidate_id="owcand_public_academic_calendar",
                target_label="中央民族大学公开校历",
            )
            _write_calendar_bundle(output_dir, calendar_match, "owrun_academic_calendar_images")
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_calendar",
                raw_version_id="owver_calendar",
                normalized_canonical_url="https://www.example.edu/calendar.htm",
                page_title="民大校历",
                page_family="article_detail",
                target_matches=[calendar_match],
                blocks=[
                    _calendar_block("title-1", 0, "title", "民大校历"),
                    _calendar_image_block(
                        "img-1",
                        1,
                        html_fragment=(
                            '<img src="/__local/calendar-fall.jpg" alt="2025-2026学年秋季学期校历">'
                        ),
                        link_target="https://www.example.edu/__local/calendar-fall.jpg",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidate = report.consumer_candidate_pages[0]
            typed_candidate = candidate["typed_candidate"]
            self.assertEqual(
                typed_candidate["calendar_image_refs"],
                [
                    {
                        "source_url": "https://www.example.edu/__local/calendar-fall.jpg",
                        "alt_text": "2025-2026学年秋季学期校历",
                        "row_id": "img-1",
                    }
                ],
            )
            self.assertEqual(typed_candidate["records"], [])
            self.assertEqual(
                candidate["quality_gate"],
                {"decision": "reject", "reason_codes": ["missing_structured_calendar_records"]},
            )

    def test_academic_calendar_candidate_filters_decorative_image_evidence(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            calendar_match = _target_match(
                consumer_family="academic_calendar_candidate",
                materialization_policy="candidate_only",
                selected_write_target="calendar/academic_calendar",
                target_id="official-web-academic-calendar",
                target_job_id="owtarget_academic_calendar",
                target_candidate_id="owcand_public_academic_calendar",
                target_label="中央民族大学公开校历",
            )
            _write_calendar_bundle(
                output_dir,
                calendar_match,
                "owrun_academic_calendar_decorative_images",
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_calendar",
                raw_version_id="owver_calendar",
                normalized_canonical_url="https://www.example.edu/calendar.htm",
                page_title="民大校历",
                page_family="article_detail",
                target_matches=[calendar_match],
                blocks=[
                    _calendar_block("title-1", 0, "title", "民大校历"),
                    _calendar_image_block(
                        "logo-1",
                        1,
                        html_fragment='<img src="/images/logo.png" alt="学校标识">',
                        link_target="https://www.example.edu/images/logo.png",
                        is_navigation=True,
                        is_boilerplate=True,
                    ),
                    _calendar_image_block(
                        "banner-1",
                        2,
                        html_fragment='<img src="/images/banner.jpg" alt="">',
                        link_target="https://www.example.edu/images/banner.jpg",
                    ),
                    _calendar_image_block(
                        "calendar-1",
                        3,
                        html_fragment='<img src="/__local/calendar-spring.jpg" class="img_vsb_content">',
                        link_target="https://www.example.edu/__local/calendar-spring.jpg",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            typed_candidate = report.consumer_candidate_pages[0]["typed_candidate"]
            self.assertEqual(
                typed_candidate["calendar_image_refs"],
                [
                    {
                        "source_url": "https://www.example.edu/__local/calendar-spring.jpg",
                        "alt_text": "",
                        "row_id": "calendar-1",
                    }
                ],
            )


def _write_calendar_bundle(
    output_dir: Path,
    calendar_match: dict[str, object],
    crawl_run_id: str,
) -> None:
    _write_json(
        output_dir / "source-truth-bundle.json",
        {
            "schemaVersion": "official_web_source_truth_bundle.v1",
            "sourceChannel": "official_web",
            "siteId": "campus_public",
            "crawlRunId": crawl_run_id,
            "collectionMode": "target-workset",
            "generatedAt": "2026-05-01T09:00:00.000Z",
            "pages": [
                _page_bundle_entry(
                    raw_asset_id="owasset_calendar",
                    raw_version_id="owver_calendar",
                    normalized_canonical_url="https://www.example.edu/calendar.htm",
                    page_family="article_detail",
                    target_matches=[calendar_match],
                ),
            ],
        },
    )


def _calendar_block(
    row_id: str,
    row_index: int,
    block_role: str,
    text: str,
) -> dict[str, object]:
    return _block(
        raw_asset_id="owasset_calendar",
        raw_version_id="owver_calendar",
        row_id=row_id,
        row_index=row_index,
        block_order=row_index,
        block_role=block_role,
        text=text,
    )


def _calendar_image_block(
    row_id: str,
    row_index: int,
    *,
    html_fragment: str,
    link_target: str,
    is_navigation: bool = False,
    is_boilerplate: bool = False,
) -> dict[str, object]:
    return _block(
        raw_asset_id="owasset_calendar",
        raw_version_id="owver_calendar",
        row_id=row_id,
        row_index=row_index,
        block_order=row_index,
        block_role="metadata",
        text="",
        is_main_content=False,
        is_navigation=is_navigation,
        is_boilerplate=is_boilerplate,
        html_fragment=html_fragment,
        link_target=link_target,
    )


if __name__ == "__main__":
    unittest.main()
