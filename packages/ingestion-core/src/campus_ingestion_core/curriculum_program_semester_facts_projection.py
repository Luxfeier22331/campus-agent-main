from __future__ import annotations


_SEMESTER_LABEL_TO_INDEX = {
    "第一学期": "1",
    "第二学期": "2",
    "第三学期": "3",
    "第四学期": "4",
    "第五学期": "5",
    "第六学期": "6",
    "第七学期": "7",
    "第八学期": "8",
    "第九学期": "9",
    "第十学期": "10",
}


def build_curriculum_program_semester_fact_document_id(
    source_document_id: str,
    semester_label: str,
) -> str:
    suffix = source_document_id.split(":", 1)[-1].strip()
    semester_index = _SEMESTER_LABEL_TO_INDEX.get(semester_label, "").strip()
    if not suffix or not semester_index:
        raise ValueError("source_document_id and semester_label must be resolvable")
    return f"program_semester_facts:{suffix}:semester-{semester_index}"


__all__ = ["build_curriculum_program_semester_fact_document_id"]
