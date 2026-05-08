from __future__ import annotations

import json
import unittest

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_processed_artifact_key
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_shared.answer_ready_evidence_contract import (
    ANSWER_READY_CATEGORY_REGISTRY_VERSION,
    ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION,
)
from campus_shared.regulation_semantic_registry import load_regulation_discovery_config

from tests.ingestion._handbook_chunking_test_support import (
    build_hermetic_handbook_v3_chunk_profile,
)


def _institutional_registry_record(document_id: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id=f"owregver:{document_id}",
        source_uri=f"https://www.muc.edu.cn/{document_id}.htm",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection="institutional_rules",
        cleaning_policy_version="institutional_rules_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        status="active",
        ingestion_timestamp="2026-05-07T00:00:00+00:00",
        parser_version="official-web-regulation-source-truth-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="official_web",
        import_source="official_web_regulation_source_truth_materialization",
        document_units_object_key=build_processed_artifact_key(
            corpus="regulations",
            collection="institutional_rules",
            document_id=document_id,
            revision_track="current-effective",
            version_id=f"owregver:{document_id}",
            title=None,
            year=None,
            filename="document-units.jsonl",
        ),
        processed_object_keys=(),
    )


def _structured_row(
    *,
    doc_id: str,
    version_id: str,
    unit_type: str,
    clean_text: str,
    root_unit_id: str,
    anchor: dict[str, object] | None = None,
    metadata: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "doc_id": doc_id,
        "version_id": version_id,
        "chunk_id": root_unit_id,
        "unit_type": unit_type,
        "root_unit_id": root_unit_id,
        "clean_text": clean_text,
        "anchor": anchor or {"page_start": 1, "page_end": 1},
        "metadata": metadata or {},
        "acl": {"level": "restricted", "allow_groups": ["campus_members"]},
    }


class InstitutionalRegulationSemanticRegressionsTest(unittest.TestCase):
    def _build_chunks(
        self,
        *,
        document_id: str,
        rows: tuple[dict[str, object], ...],
    ):
        record = _institutional_registry_record(document_id)
        structured_payload = (
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
        ).encode("utf-8")
        return build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

    def _row(
        self,
        *,
        document_id: str,
        root_unit_id: str,
        clean_text: str,
        section_path: tuple[str, ...],
        title: str,
        article_label: str = "",
        provision_label: str = "",
        promotion_class: str = "",
    ) -> dict[str, object]:
        record = _institutional_registry_record(document_id)
        anchor: dict[str, object] = {"section_path": list(section_path)}
        if article_label:
            anchor["article_label"] = article_label
        if provision_label:
            anchor["provision_label"] = provision_label
        metadata: dict[str, object] = {
            "title": title,
            "content_role": "regulation_body",
        }
        if promotion_class:
            metadata["promotion_class"] = promotion_class
        return _structured_row(
            doc_id=record.document_id,
            version_id=record.version_id,
            unit_type="regulation_body",
            root_unit_id=root_unit_id,
            clean_text=clean_text,
            anchor=anchor,
            metadata=metadata,
        )

    def test_material_list_intro_with_submit_followed_by_children_emits_typed_material_contract(
        self,
    ) -> None:
        record = _institutional_registry_record("institutional-material-list-intro-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-material-list-intro-test:unit-0013",
                    clean_text="\n".join(
                        [
                            "申诉人应提交以下材料：",
                            "（一）书面申请。",
                            "（二）相关证明材料。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第三章 申诉程序", "申诉材料"],
                        "article_label": "第十三条",
                    },
                    metadata={
                        "title": "中央民族大学学生申诉处理办法",
                        "content_role": "regulation_body",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        material_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["display_text"] in {"（一）书面申请。", "（二）相关证明材料。"}
        ]
        self.assertEqual(len(material_chunks), 2)
        self.assertEqual(
            tuple(chunk.metadata["answer_role"] for chunk in material_chunks),
            ("material_requirement", "material_requirement"),
        )
        self.assertEqual(
            tuple(chunk.metadata["condition_subject"] for chunk in material_chunks),
            ("material_requirement", "material_requirement"),
        )

        intro_chunks = [
            chunk for chunk in chunks if chunk.metadata["display_text"] == "申诉人应提交以下材料："
        ]
        self.assertEqual(len(intro_chunks), 1)
        intro_metadata = intro_chunks[0].metadata
        self.assertEqual(intro_metadata["answer_role"], "eligibility_intro")
        self.assertEqual(intro_metadata["intro_scope"], "material_list")
        self.assertEqual(intro_metadata["condition_subject"], "material_requirement")
        self.assertEqual(intro_metadata["intro_target_roles"], ("material_requirement",))

    def test_time_list_intro_with_below_deadlines_emits_typed_time_contract(self) -> None:
        record = _institutional_registry_record("institutional-time-list-intro-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-time-list-intro-test:unit-0014",
                    clean_text="\n".join(
                        [
                            "申诉应在下列期限内提出：",
                            "（一）收到处理决定后5个工作日内提出申诉。",
                            "（二）复核意见应在10个工作日内反馈。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第三章 申诉程序", "申诉期限"],
                        "article_label": "第十四条",
                    },
                    metadata={
                        "title": "中央民族大学学生申诉处理办法",
                        "content_role": "regulation_body",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        time_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["display_text"]
            in {
                "（一）收到处理决定后5个工作日内提出申诉。",
                "（二）复核意见应在10个工作日内反馈。",
            }
        ]
        self.assertEqual(len(time_chunks), 2)
        self.assertEqual(
            tuple(chunk.metadata["answer_role"] for chunk in time_chunks),
            ("time_constraint", "time_constraint"),
        )
        self.assertEqual(
            tuple(chunk.metadata["condition_subject"] for chunk in time_chunks),
            ("deadline", "deadline"),
        )

        intro_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["display_text"] == "申诉应在下列期限内提出："
        ]
        self.assertEqual(len(intro_chunks), 1)
        intro_metadata = intro_chunks[0].metadata
        self.assertEqual(intro_metadata["answer_role"], "eligibility_intro")
        self.assertEqual(intro_metadata["intro_scope"], "time_list")
        self.assertEqual(intro_metadata["condition_subject"], "deadline")
        self.assertEqual(intro_metadata["intro_target_roles"], ("time_constraint",))

    def test_oracle_institutional_material_and_deadline_slices_freeze_group_contracts(
        self,
    ) -> None:
        document_id = "institutional-appeal-oracle-slices-test"
        chunks = self._build_chunks(
            document_id=document_id,
            rows=(
                self._row(
                    document_id=document_id,
                    root_unit_id=f"{document_id}:unit-0013",
                    clean_text="\n".join(
                        [
                            "申诉人应提交以下材料：",
                            "（一）书面申请。",
                            "（二）相关证明材料。",
                        ]
                    ),
                    section_path=("第三章 申诉程序", "申诉材料"),
                    article_label="第十三条",
                    title="中央民族大学学生申诉处理办法",
                ),
                self._row(
                    document_id=document_id,
                    root_unit_id=f"{document_id}:unit-0014",
                    clean_text="\n".join(
                        [
                            "申诉应在下列期限内提出：",
                            "（一）收到处理决定后5个工作日内提出申诉。",
                            "（二）复核意见应在10个工作日内反馈。",
                        ]
                    ),
                    section_path=("第三章 申诉程序", "申诉期限"),
                    article_label="第十四条",
                    title="中央民族大学学生申诉处理办法",
                ),
            ),
        )

        chunks_by_text = {chunk.metadata["display_text"]: chunk for chunk in chunks}

        material_intro = chunks_by_text["申诉人应提交以下材料："].metadata
        self.assertEqual(material_intro["answer_role"], "eligibility_intro")
        self.assertEqual(material_intro["condition_subject"], "material_requirement")
        self.assertEqual(material_intro["condition_group_subject"], "material_requirement")
        self.assertEqual(material_intro["intro_scope"], "material_list")
        self.assertEqual(material_intro["intro_target_roles"], ("material_requirement",))
        self.assertEqual(
            material_intro["condition_subject_taxonomy_version"],
            ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION,
        )
        material_group_id = material_intro["introduced_condition_group_id"]
        self.assertEqual(material_group_id, material_intro["condition_group_id"])
        self.assertTrue(material_group_id.endswith(":material_requirement"))

        for display_text in ("（一）书面申请。", "（二）相关证明材料。"):
            metadata = chunks_by_text[display_text].metadata
            self.assertEqual(metadata["answer_role"], "material_requirement")
            self.assertEqual(metadata["condition_subject"], "material_requirement")
            self.assertEqual(metadata["condition_group_subject"], "material_requirement")
            self.assertEqual(metadata["condition_group_id"], material_group_id)
            self.assertEqual(metadata["answer_ready_contract_validation_status"], "passed")
            self.assertEqual(metadata["answer_ready_contract_validation_issues"], ())

        deadline_intro = chunks_by_text["申诉应在下列期限内提出："].metadata
        self.assertEqual(deadline_intro["answer_role"], "eligibility_intro")
        self.assertEqual(deadline_intro["condition_subject"], "deadline")
        self.assertEqual(deadline_intro["condition_group_subject"], "deadline")
        self.assertEqual(deadline_intro["intro_scope"], "time_list")
        self.assertEqual(deadline_intro["intro_target_roles"], ("time_constraint",))
        self.assertEqual(
            deadline_intro["condition_subject_taxonomy_version"],
            ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION,
        )
        deadline_group_id = deadline_intro["introduced_condition_group_id"]
        self.assertEqual(deadline_group_id, deadline_intro["condition_group_id"])
        self.assertTrue(deadline_group_id.endswith(":deadline"))

        for display_text in (
            "（一）收到处理决定后5个工作日内提出申诉。",
            "（二）复核意见应在10个工作日内反馈。",
        ):
            metadata = chunks_by_text[display_text].metadata
            self.assertEqual(metadata["answer_role"], "time_constraint")
            self.assertEqual(metadata["condition_subject"], "deadline")
            self.assertEqual(metadata["condition_group_subject"], "deadline")
            self.assertEqual(metadata["condition_group_id"], deadline_group_id)
            self.assertEqual(metadata["answer_ready_contract_validation_status"], "passed")
            self.assertEqual(metadata["answer_ready_contract_validation_issues"], ())

        self.assertNotEqual(material_group_id, deadline_group_id)

    def test_oracle_institutional_category_discovery_slice_freezes_registry_backed_overview(
        self,
    ) -> None:
        discovery = load_regulation_discovery_config("institutional_rules")
        category = next(
            category
            for category in discovery.categories
            if category.category_id == "public_service"
        )
        document_id = category.overview_document_id
        chunks = self._build_chunks(
            document_id=document_id,
            rows=(
                self._row(
                    document_id=document_id,
                    root_unit_id=f"{document_id}:unit-0001",
                    clean_text="校园卡业务由相关部门按制度办理。",
                    section_path=("校园服务制度",),
                    article_label="第一条",
                    title="中央民族大学校园卡管理办法",
                    promotion_class="formal_regulation",
                ),
            ),
        )

        overview_chunks = [
            chunk for chunk in chunks if chunk.metadata.get("answer_role") == "category_overview"
        ]
        self.assertEqual(len(overview_chunks), 1)
        metadata = overview_chunks[0].metadata
        expected_titles = tuple(
            discovery.policy_titles_by_document_id[document_id]
            for document_id in category.member_policy_document_ids
        )

        self.assertEqual(metadata["condition_subject"], "audience_scope")
        self.assertEqual(
            metadata["condition_subject_taxonomy_version"],
            ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION,
        )
        self.assertEqual(metadata["category_id"], category.category_id)
        self.assertEqual(metadata["audience"], category.audience)
        self.assertEqual(
            tuple(metadata["member_policy_document_ids"]),
            category.member_policy_document_ids,
        )
        self.assertEqual(tuple(metadata["member_policy_titles"]), expected_titles)
        self.assertEqual(
            metadata["category_registry_version"],
            ANSWER_READY_CATEGORY_REGISTRY_VERSION,
        )
        self.assertEqual(metadata["answer_ready_contract_validation_status"], "passed")
        self.assertEqual(metadata["answer_ready_contract_validation_issues"], ())

    def test_single_procedure_clause_with_review_and_signoff_stays_procedure_step(self) -> None:
        record = _institutional_registry_record("institutional-procedure-signoff-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-procedure-signoff-test:unit-0012",
                    clean_text="（二）培养单位的学位评定分委员会和党政联席会审查后签署意见。",
                    anchor={
                        "section_path": [
                            "第二章 涉密学位论文的定密与申请",
                            "第七条 涉密学位论文申请程序",
                        ],
                        "provision_label": "（二）",
                    },
                    metadata={
                        "title": "中央民族大学研究生涉密学位论文管理办法（试行）",
                        "content_role": "regulation_body",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["content_role"], "procedure")
        self.assertEqual(metadata["condition_subject"], "application_procedure")
        self.assertEqual(metadata["procedure_actor"], "college")
        self.assertTrue(metadata["procedure_action"])

    def test_procedure_section_application_step_stays_procedure_step(self) -> None:
        record = _institutional_registry_record("institutional-procedure-apply-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-procedure-apply-test:unit-0010",
                    clean_text=(
                        "1. 个人自主申报或推荐申报。申报人可根据申报条件自主申报，"
                        "也可由学院党政联席会提名申报，申报人填写申报表以及优秀事迹等材料报所在学院。"
                    ),
                    anchor={
                        "section_path": ["第四章 评选名额与评选程序"],
                        "provision_label": "1.",
                    },
                    metadata={
                        "title": "中央民族大学优秀研究生导师、优秀研究生导师团队评选办法（试行）",
                        "content_role": "regulation_body",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["content_role"], "procedure")
        self.assertEqual(metadata["condition_subject"], "application_procedure")
        self.assertTrue(metadata["procedure_action"])

    def test_procedure_section_disbursement_step_stays_procedure_step(self) -> None:
        record = _institutional_registry_record("institutional-procedure-disbursement-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-procedure-disbursement-test:unit-0004",
                    clean_text=(
                        "（四）发放。国际合作处汇总学生信息并制作资助明细表转财务处。"
                        "财务处按表拨付至学生用于缴纳学费的银行卡内。"
                    ),
                    anchor={
                        "section_path": ["第四条 奖励申请、审核及发放程序"],
                        "provision_label": "（四）",
                    },
                    metadata={
                        "title": "中央民族大学学生参加国际外语水平考试暨国际化培养项目奖励暂行办法",
                        "content_role": "regulation_body",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["content_role"], "procedure")
        self.assertEqual(metadata["condition_subject"], "application_procedure")
        self.assertTrue(metadata["procedure_action"])

    def test_negative_unsuitable_clause_is_not_misclassified_as_procedure(self) -> None:
        record = _institutional_registry_record("institutional-procedure-negative-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-procedure-negative-test:unit-0005",
                    clean_text="（五）其他不宜接收为直博生的情况。",
                    anchor={
                        "section_path": ["第三章 申请及考核程序"],
                        "provision_label": "（五）",
                    },
                    metadata={
                        "title": "中央民族大学接收校内外优秀应届本科毕业生免试攻读博士研究生工作办法（试行）",
                        "content_role": "regulation_body",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "exclusion_rule")
        self.assertNotEqual(metadata["condition_subject"], "application_procedure")

    def test_single_clause_mixed_security_requirement_and_application_splits_procedure_tail(
        self,
    ) -> None:
        record = _institutional_registry_record("institutional-security-application-mixed-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-security-application-mixed-test:unit-0008",
                    clean_text=(
                        "（一）学位论文主题、研究方向、主要内容或成果涉及国家秘密的，开题前，"
                        "导师和研究生须根据所执行科研项目的密级定密，涉密学位论文的密级与论文选题来源"
                        "课题的密级一致；学位论文主题、研究方向和内容等属于自发研究，没有涉密科研、"
                        "生产项目或任务支撑，相关内容泄露后会损害国家安全和利益，确需定密的，"
                        "开题前应向学校提出学位论文定密申请（内容包括密级、保密期限和知悉范围等）。"
                        "学校按照国家秘密定密管理有关规定审定密级。"
                    ),
                    anchor={
                        "section_path": ["第二章 涉密学位论文的定密与申请"],
                        "provision_label": "（一）",
                    },
                    metadata={
                        "title": "中央民族大学研究生涉密学位论文管理办法（试行）",
                        "content_role": "regulation_body",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        condition_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["answer_role"] == "eligibility_condition"
            and "涉及国家秘密" in chunk.metadata["display_text"]
        ]
        procedure_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["answer_role"] == "procedure_step"
            and (
                "提出学位论文定密申请" in chunk.metadata["display_text"]
                or "审定密级" in chunk.metadata["display_text"]
            )
        ]

        self.assertTrue(condition_chunks)
        self.assertTrue(procedure_chunks)
        self.assertTrue(
            all(
                chunk.metadata["answer_role"] == "eligibility_condition"
                for chunk in condition_chunks
            )
        )
        self.assertTrue(
            all(chunk.metadata["answer_role"] == "procedure_step" for chunk in procedure_chunks)
        )

    def test_formal_regulation_procedure_clause_does_not_split_into_false_condition_head(
        self,
    ) -> None:
        record = _institutional_registry_record("institutional-formal-procedure-no-false-head-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-formal-procedure-no-false-head-test:unit-0015",
                    clean_text=(
                        "（一）涉密学位论文的申请应在论文开题之前进行。"
                        "研究生与其导师共同提出定密申请，提供可作为学位论文定密依据的相关证明材料，"
                        "填写《中央民族大学涉密研究生学位论文申请表》（以下简称《涉密论文申请表》）。"
                    ),
                    anchor={
                        "section_path": [
                            "第二章 涉密学位论文的定密与申请",
                            "第七条 涉密学位论文申请程序",
                        ],
                        "provision_label": "（一）",
                    },
                    metadata={
                        "title": "中央民族大学研究生涉密学位论文管理办法（试行）",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["condition_subject"], "application_procedure")

    def test_formal_regulation_review_clause_does_not_split_into_false_condition_head(self) -> None:
        record = _institutional_registry_record("institutional-formal-review-no-false-head-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-formal-review-no-false-head-test:unit-0028",
                    clean_text=(
                        "（四）复议。被考核人如果对考核结果有异议，可在公示期内向所在单位申请复核。"
                        "对复核结果仍有异议，被考核者可向组织部人事处提出申请。"
                    ),
                    anchor={
                        "section_path": ["第五条 考核程序"],
                        "provision_label": "（四）",
                    },
                    metadata={
                        "title": "中央民族大学教职工考核办法（试行）",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["condition_subject"], "application_procedure")

    def test_procedure_titled_section_quota_clause_does_not_become_procedure_step(self) -> None:
        record = _institutional_registry_record("institutional-procedure-quota-clause-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-procedure-quota-clause-test:unit-0009",
                    clean_text="第九条 评选名额。全校每次评选优秀导师10名左右，评选优秀导师团队5支左右。",
                    anchor={
                        "section_path": ["第三章 评选名额与评选程序"],
                        "article_label": "第九条",
                    },
                    metadata={
                        "title": "中央民族大学优秀研究生导师、优秀研究生导师团队评选办法（试行）",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertNotEqual(metadata["answer_role"], "procedure_step")
        self.assertNotEqual(metadata.get("procedure_action"), "procedure_step")
        self.assertNotEqual(metadata.get("procedure_actor"), "responsible_party")

    def test_procedure_titled_section_result_usage_clause_does_not_become_procedure_step(
        self,
    ) -> None:
        record = _institutional_registry_record("institutional-procedure-result-usage-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-procedure-result-usage-test:unit-0013",
                    clean_text=(
                        "第十三条 各级党组织考核为“好”的，作为申报上级党组织评优评先活动的依据；"
                        "考核为“较好”以上的，方可参评校内评优评先。"
                    ),
                    anchor={
                        "section_path": ["第四章 考核程序"],
                        "article_label": "第十三条",
                    },
                    metadata={
                        "title": "中央民族大学基层党组织考核办法（试行）",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertNotEqual(metadata["answer_role"], "procedure_step")
        self.assertNotEqual(metadata.get("procedure_action"), "procedure_step")
        self.assertNotEqual(metadata.get("procedure_actor"), "responsible_party")

    def test_procedure_titled_section_prohibition_clause_does_not_become_procedure_step(
        self,
    ) -> None:
        record = _institutional_registry_record("institutional-procedure-prohibition-clause-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-procedure-prohibition-clause-test:unit-0007",
                    clean_text="（七）发放任何形式的个人补助；",
                    anchor={
                        "section_path": ["第二章 经费审批程序"],
                        "provision_label": "（七）",
                    },
                    metadata={
                        "title": "中央民族大学专项经费管理办法",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "exclusion_rule")
        self.assertIsNone(metadata.get("procedure_action"))
        self.assertIsNone(metadata.get("procedure_actor"))

    def test_official_web_planning_prose_does_not_emit_intro_contract(self) -> None:
        record = _institutional_registry_record("official_web_regulation:12ce0e9b47598c5d")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official_web_regulation:12ce0e9b47598c5d:unit-0001",
                    clean_text=(
                        "积极推进学校治理体系和治理能力现代化，完善内部治理结构，"
                        "不断提升办学质量和服务水平。"
                    ),
                    anchor={
                        "section_path": ["中央民族大学事业发展“十三五”规划"],
                    },
                    metadata={
                        "title": "中央民族大学事业发展“十三五”规划",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                        "source_channel": "official_web",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "supporting_detail")
        self.assertIsNone(metadata.get("intro_scope"))
        self.assertIsNone(metadata.get("intro_target_roles"))

    def test_formal_regulation_reviewer_recusal_intro_does_not_become_procedure_step(self) -> None:
        record = _institutional_registry_record("institutional-recusal-intro-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-recusal-intro-test:unit-0022",
                    clean_text="第二十二条 调解委员会成员有下列情形之一者，当事人有权以书面形式申请要求其回避：",
                    anchor={
                        "section_path": ["第四章 调解程序"],
                        "article_label": "第二十二条",
                    },
                    metadata={
                        "title": "中央民族大学校内纠纷调解办法",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "eligibility_intro")
        self.assertIsNone(metadata.get("procedure_actor"))
        self.assertIsNone(metadata.get("procedure_action"))

    def test_official_web_eligibility_intro_does_not_emit_generic_procedure_step_fallback(
        self,
    ) -> None:
        record = _institutional_registry_record("official_web_regulation:de10f64c02d1be9b")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official_web_regulation:de10f64c02d1be9b:unit-0130",
                    clean_text="\n".join(
                        [
                            "具有下列条件之一者，可申报六级职员岗位：",
                            "1．处级副职。",
                            "2．科级正职12年及以上。",
                            "3. 科级正职6年及以上，且具有高级专业技术职务。",
                        ]
                    ),
                    anchor={
                        "section_path": ["（三）六级职员岗位"],
                    },
                    metadata={
                        "title": "中央民族大学岗位设置与聘用管理暂行办法",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                        "source_channel": "official_web",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertGreaterEqual(len(chunks), 4)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["display_text"], "具有下列条件之一者，可申报六级职员岗位：")
        self.assertEqual(metadata["answer_role"], "eligibility_intro")
        self.assertEqual(metadata.get("condition_subject"), "generic_condition")
        self.assertEqual(metadata.get("intro_target_roles"), ("eligibility_condition",))
        self.assertEqual(metadata.get("intro_scope"), "eligibility_group")
        self.assertIsNone(metadata.get("procedure_actor"))
        self.assertIsNone(metadata.get("procedure_action"))

    def test_institutional_break_study_intro_keeps_non_procedure_intro_shape(self) -> None:
        record = _institutional_registry_record(
            "institutional_regulation:muc:中央民族大学研究生学籍管理办法:d11f18c41059"
        )
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id=(
                        "institutional_regulation:muc:中央民族大学研究生学籍管理办法:d11f18c41059:unit-0063"
                    ),
                    clean_text="研究生有下列情形之一者，应当办理休学手续：",
                    anchor={
                        "section_path": ["第五章 休学与复学"],
                        "article_label": "第二十三条",
                    },
                    metadata={
                        "title": "中央民族大学研究生学籍管理办法",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "eligibility_intro")
        self.assertEqual(metadata.get("condition_subject"), "generic_restriction")
        self.assertEqual(metadata.get("condition_group_subject"), "generic_restriction")
        self.assertEqual(metadata.get("intro_scope"), "eligibility_group")
        self.assertEqual(metadata.get("intro_target_roles"), ("exclusion_rule",))
        self.assertIsNone(metadata.get("procedure_actor"))
        self.assertIsNone(metadata.get("procedure_action"))


if __name__ == "__main__":
    unittest.main()
