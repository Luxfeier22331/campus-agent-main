from __future__ import annotations

import unittest

from .handbook_chunking_validation_test_support import *


class HandbookChunkingValidationTextualFailuresTest(unittest.TestCase):
    def test_validation_fails_when_chunk_contains_broken_policy_doc_no_linebreak(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:broken-citation-doc",
                version_id="v1:broken-citation-doc",
                title="断行制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="断行制度"),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            payload = (
                json.dumps(
                    {
                        **_structured_row(
                            doc_id=record.document_id,
                            version_id=record.version_id,
                            unit_type="article_body",
                            clean_text="第一条 百分制成绩、成绩等级及学分绩点的对应关系根据《示例大学本科学生学籍管理规定》(民大校发\n[2009]89号)规定执行。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "断行制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第一章 总则"],
                            "article_label": "第一条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-agent-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.broken_citation_linebreak_count, 1)

    def test_validation_fails_when_chunk_contains_unclosed_citation_context(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:unclosed-citation-doc",
                version_id="v1:unclosed-citation-doc",
                title="未闭合引文制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(
                                document_id=record.document_id, title="未闭合引文制度"
                            ),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            payload = (
                json.dumps(
                    {
                        **_structured_row(
                            doc_id=record.document_id,
                            version_id=record.version_id,
                            unit_type="article_body",
                            clean_text="第一条 为认真贯彻有关精神,根据《示例大学关于进一步加强和改进新时期大学生思想政治教育的实施意见》(民大党发〔2009〕41号的精神,特制定本办法。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "未闭合引文制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第一章 总则"],
                            "article_label": "第一条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-agent-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.unclosed_citation_context_count, 1)

    def test_validation_fails_when_chunk_contains_heading_body_glue(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:heading-glue-doc",
                version_id="v1:heading-glue-doc",
                title="粘连制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="粘连制度"),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            payload = (
                json.dumps(
                    {
                        **_structured_row(
                            doc_id=record.document_id,
                            version_id=record.version_id,
                            unit_type="article_body",
                            clean_text="第八条 十佳大学生评选程序\n3. 候选人公示示例大学十佳大学生候选人在学生工作部网站公示一周,接受监督。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "粘连制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第三章 评选程序"],
                            "article_label": "第八条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-agent-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.heading_body_glue_count, 1)

    def test_validation_fails_when_article_heading_is_glued_to_body(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:article-heading-glue-doc",
                version_id="v1:article-heading-glue-doc",
                title="条文粘连制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(
                                document_id=record.document_id, title="条文粘连制度"
                            ),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            payload = (
                json.dumps(
                    {
                        **_structured_row(
                            doc_id=record.document_id,
                            version_id=record.version_id,
                            unit_type="article_body",
                            clean_text="第十二条 毕业、结业与肄业参加留学项目学生返校后,必须按学校各项要求完成学习任务。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "条文粘连制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第五章 附则"],
                            "article_label": "第十二条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-agent-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.heading_body_glue_count, 1)

    def test_validation_ignores_regular_clause_lines_that_contain_participation_verbs(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:regular-clause-doc",
                version_id="v1:regular-clause-doc",
                title="常规条款制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(
                                document_id=record.document_id, title="常规条款制度"
                            ),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            payload = (
                json.dumps(
                    {
                        **_structured_row(
                            doc_id=record.document_id,
                            version_id=record.version_id,
                            unit_type="article_body",
                            clean_text="第七条 评选条件\n(四)积极参加体育锻炼,身心健康;",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "常规条款制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第二章 评选条件"],
                            "article_label": "第七条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-agent-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertEqual(report.heading_body_glue_count, 0)

    def test_validation_ignores_compact_identity_path_headers(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:path-header-doc",
                version_id="v1:path-header-doc",
                title="路径标题制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(
                                document_id=record.document_id, title="路径标题制度"
                            ),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            payload = (
                json.dumps(
                    {
                        **_structured_row(
                            doc_id=record.document_id,
                            version_id=record.version_id,
                            unit_type="policy_page",
                            clean_text="学生参加公益服务活动应当在学有余力的情况下进行。",
                            root_unit_id="policy-page-001",
                        ),
                        "metadata": {
                            "title": "示例大学本科受资助学生参与公益服务活动实施办法",
                            "policy_doc_no": "民大学发[2013]7号",
                        },
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["二、活动原则"],
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-agent-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertEqual(report.heading_body_glue_count, 0)

    def test_validation_ignores_procedural_phrase_after_heading_keyword(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:procedural-phrase-doc",
                version_id="v1:procedural-phrase-doc",
                title="程序说明制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(
                                document_id=record.document_id, title="程序说明制度"
                            ),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            payload = (
                json.dumps(
                    {
                        **_structured_row(
                            doc_id=record.document_id,
                            version_id=record.version_id,
                            unit_type="article_body",
                            clean_text="第七条 选拔程序与要求\n(九)办理出国(境)手续\n公示无异议后,教务处将学生信息送交国际合作处。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "程序说明制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第二章 申请与选拔"],
                            "article_label": "第七条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-agent-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertEqual(report.heading_body_glue_count, 0)

    def test_validation_still_flags_heading_body_glue_when_remainder_starts_with_wu(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:wu-heading-glue-doc",
                version_id="v1:wu-heading-glue-doc",
                title="减免制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="减免制度"),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            payload = (
                json.dumps(
                    {
                        **_structured_row(
                            doc_id=record.document_id,
                            version_id=record.version_id,
                            unit_type="article_body",
                            clean_text="第五条 资助方式\n(六)学费、住宿费减免无经济来源的烈士子女可申请减免学费、住宿费。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "减免制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第三章 主要资助方式"],
                            "article_label": "第五条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-agent-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.heading_body_glue_count, 1)

    def test_validation_fails_when_chunk_contains_repeated_heading_body_glue(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:repeated-heading-glue-doc",
                version_id="v1:repeated-heading-glue-doc",
                title="重复标题制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(
                                document_id=record.document_id, title="重复标题制度"
                            ),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            payload = (
                json.dumps(
                    {
                        **_structured_row(
                            doc_id=record.document_id,
                            version_id=record.version_id,
                            unit_type="article_body",
                            clean_text="第五条 资助方式\n(一)奖学金奖学金用于奖励品学兼优、综合素质全面发展的在校学生。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "重复标题制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第三章 主要资助方式"],
                            "article_label": "第五条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-agent-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.heading_body_glue_count, 1)

    def test_validation_fails_when_chunk_contains_boundary_overlap_duplication(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:overlap-dup-doc",
                version_id="v1:overlap-dup-doc",
                title="重复制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="重复制度"),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            payload = (
                json.dumps(
                    {
                        **_structured_row(
                            doc_id=record.document_id,
                            version_id=record.version_id,
                            unit_type="article_body",
                            clean_text="第十一条 课程、学分与成绩认定\n1. 学生申请学生需要提交境外学校提供的境外课程成绩单原件1份及复印件。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "重复制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第三章 学籍管理"],
                            "article_label": "第十一条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-agent-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.adjacent_overlap_duplication_count, 1)
