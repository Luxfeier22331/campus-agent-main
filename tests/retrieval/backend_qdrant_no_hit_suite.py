from __future__ import annotations

from campus_retrieval_core.backend_qdrant_no_hit_policy import _has_query_lexical_support

from tests.retrieval.backend_qdrant_test_support import (
    STUDENT_HANDBOOK_QDRANT_COLLECTION,
    ChunkProfile,
    EvidenceSource,
    InMemoryDocumentRegistry,
    Mock,
    MockEmbeddingSettings,
    MockSparseEmbeddingSettings,
    QdrantClient,
    QdrantRetrievalBackend,
    RetrievalBackendError,
    RetrievalRequest,
    RetrievalSettings,
    _apply_no_hit_policy,
    _authorized_filter,
    _make_registry_record,
    _make_source,
    _make_structured_jsonl,
    build_indexable_chunks_from_jsonl,
    build_mock_embedding_model,
    build_mock_sparse_embedding_model,
    index_chunks_to_qdrant,
    load_runtime_profile,
    unittest,
)


class BackendQdrantNoHitPolicyTest(unittest.TestCase):
    def test_no_hit_policy_fail_closes_curriculum_ambiguous_low_score_results(self) -> None:
        profile = load_runtime_profile("curriculum", "curriculum_plan")
        result = _apply_no_hit_policy(
            profile=profile,
            query_text="火星校区飞船停靠规则",
            sources=(
                _make_source(
                    doc_id="curriculum:法学本科人才培养方案",
                    chunk_id="curriculum:law:chunk-0001",
                    snippet="法学本科人才培养方案 一、培养目标。",
                    score=0.5,
                ),
                _make_source(
                    doc_id="curriculum:美术学类本科人才培养方案",
                    chunk_id="curriculum:fine-arts:chunk-0001",
                    snippet="美术学类本科人才培养方案 一、培养目标。",
                    score=0.5,
                ),
            ),
        )

        self.assertEqual(result, ())

    def test_no_hit_policy_rejects_nonexistent_curriculum_program_with_only_boilerplate_matches(
        self,
    ) -> None:
        profile = load_runtime_profile("curriculum", "curriculum_plan")

        result = _apply_no_hit_policy(
            profile=profile,
            query_text="量子飞船驾驶本科人才培养方案",
            sources=(
                _make_source(
                    doc_id="curriculum:美术学类本科人才培养方案",
                    chunk_id="curriculum:fine-arts:chunk-0001",
                    snippet="美术学类本科人才培养方案 一、培养目标。",
                    score=0.5,
                ),
                _make_source(
                    doc_id="curriculum:新闻传播学类本科人才培养方案",
                    chunk_id="curriculum:journalism:chunk-0001",
                    snippet="新闻传播学类本科人才培养方案 一、培养目标。",
                    score=0.5,
                ),
                _make_source(
                    doc_id="curriculum:设计学类本科人才培养方案",
                    chunk_id="curriculum:design:chunk-0001",
                    snippet="设计学类本科人才培养方案 一、培养目标。",
                    score=0.5,
                ),
            ),
        )

        self.assertEqual(result, ())

    def test_no_hit_policy_rejects_generic_single_bigram_match_across_tied_candidates(self) -> None:
        profile = load_runtime_profile("regulations", "student_rules")
        sources = (
            EvidenceSource(
                doc_id="handbook:loan",
                revision_track="source-faithful",
                version_id="v1:loan",
                chunk_id="chunk-loan",
                anchor={},
                canonical_url="https://campus.example/loan",
                latest_url="https://campus.example/loan",
                source_channel="pdf_ocr",
                collection="student_rules",
                is_current=True,
                snippet="第十条 国家助学贷款还款:办理过国家助学贷款的毕业生于毕业前确认还款手续。",
                score=0.5,
            ),
            EvidenceSource(
                doc_id="handbook:order",
                revision_track="source-faithful",
                version_id="v1:order",
                chunk_id="chunk-order",
                anchor={},
                canonical_url="https://campus.example/order",
                latest_url="https://campus.example/order",
                source_channel="pdf_ocr",
                collection="student_rules",
                is_current=True,
                snippet="外国人、港澳台人员进入学校进行公务、业务活动应当告知学校。",
                score=0.5,
            ),
        )

        result = _apply_no_hit_policy(
            profile=profile,
            query_text="校内宇宙签证办理处",
            sources=sources,
        )

        self.assertEqual(result, ())

    def test_no_hit_policy_rejects_live_like_weak_bigram_matches(self) -> None:
        profile = load_runtime_profile("regulations", "student_rules")
        sources = (
            EvidenceSource(
                doc_id="handbook:discipline",
                revision_track="source-faithful",
                version_id="v1:discipline",
                chunk_id="chunk-discipline",
                anchor={},
                canonical_url="https://campus.example/discipline",
                latest_url="https://campus.example/discipline",
                source_channel="pdf_ocr",
                collection="student_rules",
                is_current=True,
                snippet=(
                    "被开除学籍的学生由教务处或研究生院出具学习证明,学生须在接到处分决定之日起10日内"
                    "办理完相关手续并离校。逾期不办理离校手续者,学校有关部门注销其在校内的各种关系。"
                ),
                score=0.55263156,
            ),
            EvidenceSource(
                doc_id="handbook:campus-order",
                revision_track="source-faithful",
                version_id="v1:campus-order",
                chunk_id="chunk-campus-order",
                anchor={},
                canonical_url="https://campus.example/campus-order",
                latest_url="https://campus.example/campus-order",
                source_channel="pdf_ocr",
                collection="student_rules",
                is_current=True,
                snippet="外国人、港澳台人员进入学校应经批准后方可进入学校。",
                score=0.5,
            ),
        )

        result = _apply_no_hit_policy(
            profile=profile,
            query_text="校内宇宙签证办理处",
            sources=sources,
        )

        self.assertEqual(result, ())

    def test_no_hit_policy_accepts_student_rule_exact_title_query(self) -> None:
        profile = load_runtime_profile("regulations", "student_rules")
        sources = (
            _make_source(
                doc_id="student_rule:muc:student-management",
                chunk_id="student-rules:student-management:chunk-0001",
                collection="student_rules",
                source_title="中央民族大学学生管理规定",
                snippet="中央民族大学学生管理规定 总则。",
                score=0.033333335,
            ),
            _make_source(
                doc_id="student_rule:muc:undergraduate-status",
                chunk_id="student-rules:undergraduate-status:chunk-0001",
                collection="student_rules",
                source_title="中央民族大学本科生学籍管理规定",
                snippet="中央民族大学本科生学籍管理规定 学籍注册。",
                score=0.032258064,
            ),
        )

        result = _apply_no_hit_policy(
            profile=profile,
            query_text="中央民族大学学生管理规定",
            sources=sources,
        )

        self.assertEqual(result, sources)

    def test_no_hit_policy_rejects_institutional_unreleased_policy_decoy(self) -> None:
        profile = load_runtime_profile("regulations", "institutional_rules")
        sources = (
            _make_source(
                doc_id="institutional_regulation:muc:党建经费",
                chunk_id="institutional-rules:party-funds:chunk-0018",
                collection="institutional_rules",
                snippet="中央民族大学党建经费管理办法 经费使用范围和审批程序。",
                score=0.033333335,
            ),
            _make_source(
                doc_id="institutional_regulation:muc:过紧日子",
                chunk_id="institutional-rules:tight-budget:chunk-0005",
                collection="institutional_rules",
                snippet="中央民族大学落实习惯过紧日子工作细则 预算支出从严控制。",
                score=0.032258064,
            ),
        )

        result = _apply_no_hit_policy(
            profile=profile,
            query_text="中央民族大学差旅费管理办法具体报销标准是什么？",
            sources=sources,
        )

        self.assertEqual(result, ())

    def test_no_hit_policy_rejects_institutional_scoped_rule_decoy(self) -> None:
        profile = load_runtime_profile("regulations", "institutional_rules")
        sources = (
            _make_source(
                doc_id="institutional_regulation:muc:研究生学籍",
                chunk_id="institutional-rules:graduate-status:chunk-0057",
                collection="institutional_rules",
                snippet="中央民族大学研究生学籍管理办法 研究生入学注册、学籍异动和毕业管理。",
                score=0.032786883,
            ),
            _make_source(
                doc_id="institutional_regulation:muc:研究生学籍",
                chunk_id="institutional-rules:graduate-status:chunk-0004",
                collection="institutional_rules",
                snippet="中央民族大学研究生学籍管理办法 适用于学校研究生学籍管理工作。",
                score=0.03137255,
            ),
        )

        result = _apply_no_hit_policy(
            profile=profile,
            query_text="历史文化学院硕博连读博士研究生招生实施细则属于校级制度吗？",
            sources=sources,
        )

        self.assertEqual(result, ())

    def test_no_hit_policy_accepts_institutional_three_assistant_title_alias(self) -> None:
        profile = load_runtime_profile("regulations", "institutional_rules")
        sources = (
            _make_source(
                doc_id="institutional_regulation:muc:中央民族大学研究生-三助-工作管理办法:49319e7c44d3",
                chunk_id="institutional-rules:three-assistants:chunk-0001",
                collection="institutional_rules",
                source_title="中央民族大学研究生“三助”工作管理办法",
                snippet="中央民族大学研究生“三助”工作管理办法 研究生助教、助研、助管岗位管理。",
                score=0.033333335,
            ),
            _make_source(
                doc_id="institutional_regulation:muc:研究生学籍",
                chunk_id="institutional-rules:graduate-status:chunk-0004",
                collection="institutional_rules",
                source_title="中央民族大学研究生学籍管理办法",
                snippet="中央民族大学研究生学籍管理办法 适用于学校研究生学籍管理工作。",
                score=0.032258064,
            ),
        )

        result = _apply_no_hit_policy(
            profile=profile,
            query_text="研究生助教助研助管工作应该依据哪份管理办法？",
            sources=sources,
        )

        self.assertEqual(result, sources)

    def test_no_hit_policy_rejects_institutional_annual_scope_membership_query(self) -> None:
        profile = load_runtime_profile("regulations", "institutional_rules")
        sources = (
            _make_source(
                doc_id=(
                    "institutional_regulation:muc:中央民族大学推荐优秀应届本科毕业生"
                    "免试攻读硕士学位研究生管理办法:8f97b86c0e95"
                ),
                chunk_id="institutional-rules:postgraduate-recommendation:chunk-0002",
                collection="institutional_rules",
                source_title="中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
                snippet="中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法 推荐条件。",
                score=0.031778056,
            ),
            _make_source(
                doc_id=(
                    "institutional_regulation:muc:中央民族大学推荐优秀应届本科毕业生"
                    "免试攻读硕士学位研究生管理办法:8f97b86c0e95"
                ),
                chunk_id="institutional-rules:postgraduate-recommendation:chunk-0003",
                collection="institutional_rules",
                source_title="中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
                snippet="学校成立推荐优秀应届本科毕业生免试攻读硕士学位研究生工作领导小组。",
                score=0.03159204,
            ),
        )

        result = _apply_no_hit_policy(
            profile=profile,
            query_text="中央民族大学2026届推荐应届本科毕业生免试攻读硕士学位研究生实施办法是当前校级制度消费范围吗？",
            sources=sources,
        )

        self.assertEqual(result, ())

    def test_no_hit_policy_rejects_institutional_college_scope_membership_query(self) -> None:
        profile = load_runtime_profile("regulations", "institutional_rules")
        sources = (
            _make_source(
                doc_id="institutional_regulation:muc:中央民族大学硕博连读研究生招生实施办法-试行:438bbad6c45e",
                chunk_id="institutional-rules:through-master-doctor:chunk-0025",
                collection="institutional_rules",
                source_title="中央民族大学硕博连读研究生招生实施办法（试行）",
                snippet="中央民族大学硕博连读研究生招生实施办法（试行） 博士研究生招生工作。",
                score=0.03306011,
            ),
            _make_source(
                doc_id="institutional_regulation:muc:中央民族大学硕博连读研究生招生实施办法-试行:438bbad6c45e",
                chunk_id="institutional-rules:through-master-doctor:chunk-0006",
                collection="institutional_rules",
                source_title="中央民族大学硕博连读研究生招生实施办法（试行）",
                snippet="硕博连读研究生招生实施按照学校博士研究生招生相关要求执行。",
                score=0.031280547,
            ),
        )

        result = _apply_no_hit_policy(
            profile=profile,
            query_text="历史文化学院硕博连读博士研究生招生实施细则属于校级制度吗？",
            sources=sources,
        )

        self.assertEqual(result, ())

    def test_query_lexical_support_rejects_institutional_generic_money_and_rule_terms(self) -> None:
        self.assertFalse(
            _has_query_lexical_support(
                query_text="中央民族大学差旅费管理办法具体报销标准是什么？",
                snippets=(
                    "中央民族大学党建经费管理办法 经费使用范围和审批程序。",
                    "中央民族大学落实习惯过紧日子工作细则 预算支出从严控制。",
                ),
            )
        )
        self.assertFalse(
            _has_query_lexical_support(
                query_text="历史文化学院硕博连读博士研究生招生实施细则属于校级制度吗？",
                snippets=(
                    "中央民族大学研究生学籍管理办法 研究生入学注册、学籍异动和毕业管理。",
                    "中央民族大学研究生学籍管理办法 适用于学校研究生学籍管理工作。",
                ),
            )
        )

    def test_no_hit_policy_rejects_institutional_live_like_title_decoys(self) -> None:
        profile = load_runtime_profile("regulations", "institutional_rules")

        travel_result = _apply_no_hit_policy(
            profile=profile,
            query_text="中央民族大学差旅费管理办法具体报销标准是什么？",
            sources=(
                _make_source(
                    doc_id="institutional_regulation:muc:党建经费",
                    chunk_id="institutional-rules:party-funds:chunk-0018",
                    collection="institutional_rules",
                    source_title="中央民族大学党建经费管理办法",
                    snippet=(
                        "中央民族大学党建经费管理办法 / 第二章 开支范围和标准 / （二）伙食费，"
                        "参照上级和学校差旅费有关规定，在差旅伙食补助费标准内据实报销。"
                    ),
                    score=0.033333335,
                ),
                _make_source(
                    doc_id="institutional_regulation:muc:过紧日子",
                    chunk_id="institutional-rules:tight-budget:chunk-0005",
                    collection="institutional_rules",
                    source_title="中央民族大学落实习惯过紧日子工作细则",
                    snippet=(
                        "标题：中央民族大学落实习惯过紧日子工作细则 | 条款：第四条 "
                        "严格执行《中央民族大学差旅费管理办法》，从严控制差旅人数和天数。"
                    ),
                    score=0.032258064,
                ),
            ),
        )
        self.assertEqual(travel_result, ())

        scoped_rule_result = _apply_no_hit_policy(
            profile=profile,
            query_text="历史文化学院硕博连读博士研究生招生实施细则属于校级制度吗？",
            sources=(
                _make_source(
                    doc_id="institutional_regulation:muc:研究生学籍",
                    chunk_id="institutional-rules:graduate-status:chunk-0057",
                    collection="institutional_rules",
                    source_title="中央民族大学研究生学籍管理办法",
                    snippet=(
                        "标题：中央民族大学研究生学籍管理办法 | 条款：第二十三条 "
                        "博士研究生、直博研究生和硕博连读研究生的最长学习年限。"
                    ),
                    score=0.030365298,
                ),
            ),
        )
        self.assertEqual(scoped_rule_result, ())

        fictional_office_result = _apply_no_hit_policy(
            profile=profile,
            query_text="中央民族大学龙宫学院水下实验室规章如何办理？",
            sources=(
                _make_source(
                    doc_id="institutional_regulation:muc:党政联席会议",
                    chunk_id="institutional-rules:joint-meeting:chunk-0032",
                    collection="institutional_rules",
                    source_title="中央民族大学学院党政联席会议议事规则",
                    snippet="中央民族大学学院党政联席会议议事规则 / 实验室基本建设和基建修缮等重要事项。",
                    score=0.030000001,
                ),
                _make_source(
                    doc_id="institutional_regulation:muc:教室使用",
                    chunk_id="institutional-rules:classroom:chunk-0001",
                    collection="institutional_rules",
                    source_title="中央民族大学教室使用管理规定",
                    snippet="中央民族大学教室使用管理规定",
                    score=0.016666668,
                ),
            ),
        )
        self.assertEqual(fictional_office_result, ())

    def test_no_hit_policy_accepts_tied_candidates_when_strong_phrase_support_exists(self) -> None:
        profile = load_runtime_profile("regulations", "student_rules")
        sources = (
            EvidenceSource(
                doc_id="handbook:student-card",
                revision_track="source-faithful",
                version_id="v1:student-card",
                chunk_id="chunk-card",
                anchor={},
                canonical_url="https://campus.example/student-card",
                latest_url="https://campus.example/student-card",
                source_channel="pdf_ocr",
                collection="student_rules",
                is_current=True,
                snippet="学生证丢失后，应持本人书面申请和相关证明材料到学生处办理补发手续。",
                score=0.5,
            ),
            EvidenceSource(
                doc_id="handbook:other",
                revision_track="source-faithful",
                version_id="v1:other",
                chunk_id="chunk-other",
                anchor={},
                canonical_url="https://campus.example/other",
                latest_url="https://campus.example/other",
                source_channel="pdf_ocr",
                collection="student_rules",
                is_current=True,
                snippet="其他规定文本。",
                score=0.5,
            ),
        )

        result = _apply_no_hit_policy(
            profile=profile,
            query_text="学生证丢了怎么办",
            sources=sources,
        )

        self.assertEqual(result, sources)

    def test_backend_maps_qdrant_errors(self) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        record = _make_registry_record(
            document_id="handbook:error-case",
            version_id="v1:error-case",
            entitlement_groups=("students",),
        )
        registry.upsert(record)
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=_make_structured_jsonl(
                document_id=record.document_id,
                version_id=record.version_id,
                text="Library hours are from 08:00 to 22:00.",
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )
        index_chunks_to_qdrant(
            chunks=chunks,
            qdrant_client=backend.qdrant_client,
            collection_name=STUDENT_HANDBOOK_QDRANT_COLLECTION,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        backend.qdrant_client.query_points = Mock(side_effect=RuntimeError("boom"))  # type: ignore[method-assign]

        with self.assertRaises(RetrievalBackendError):
            backend.retrieve(
                RetrievalRequest(
                    query_text="library hours",
                    corpus="regulations",
                    collection="student_rules",
                    authorized_filter=_authorized_filter(),
                )
            )
