from __future__ import annotations

from tests.evals.ragas_runtime_test_support import (
    RagasProjection,
    build_ragas_dataset,
    unittest,
)


class RagasDatasetTest(unittest.TestCase):
    def test_build_ragas_dataset_projects_single_turn_sample(self) -> None:
        dataset = build_ragas_dataset(
            RagasProjection(
                case_id="case-1",
                user_input="图书馆开放时间是什么？",
                response="08:00 到 22:00。",
                retrieved_contexts=("图书馆开放时间为 08:00-22:00。",),
                reference="图书馆开放时间为 08:00-22:00。",
                metadata={"collection": "student_rules"},
            )
        )

        self.assertEqual(len(dataset.samples), 1)
        sample = dataset.samples[0]
        self.assertEqual(sample.user_input, "图书馆开放时间是什么？")
        self.assertEqual(sample.response, "08:00 到 22:00。")
        self.assertEqual(sample.reference, "图书馆开放时间为 08:00-22:00。")
        self.assertEqual(sample.retrieved_contexts, ["图书馆开放时间为 08:00-22:00。"])

    def test_build_ragas_dataset_projects_reference_and_context_ids(self) -> None:
        dataset = build_ragas_dataset(
            RagasProjection(
                case_id="case-with-ids",
                user_input="学生证丢了怎么办？",
                response="应先挂失，再申请补办。",
                retrieved_contexts=("学生证遗失应及时挂失。",),
                reference="学生证遗失应及时挂失。",
                retrieved_context_ids=("handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",),
                reference_context_ids=("handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",),
                reference_contexts=("学生证遗失应及时挂失。",),
            )
        )

        sample = dataset.samples[0]
        self.assertEqual(
            sample.retrieved_context_ids, ["handbook:e90f9707387f9e232ea88ce1c7f5328242e52389"]
        )
        self.assertEqual(
            sample.reference_context_ids, ["handbook:e90f9707387f9e232ea88ce1c7f5328242e52389"]
        )
        self.assertEqual(sample.reference_contexts, ["学生证遗失应及时挂失。"])
