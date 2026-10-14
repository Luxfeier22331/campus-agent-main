"""Explicit case and saved-product inputs. Never read trace bodies or old scores."""

import json
from pathlib import Path

from inspect_ai.dataset import MemoryDataset, Sample


def normalize_case(case: dict) -> dict:
    if (
        not isinstance(case, dict)
        or not isinstance(case.get("case_id"), str)
        or not case["case_id"].strip()
    ):
        raise ValueError("case_id must be a nonempty string")
    case = dict(case)
    turns = case.get("turns")
    if turns is None:
        setup = case.get("setup_turns", [])
        if not isinstance(setup, list) or not isinstance(case.get("query"), str):
            raise ValueError("A case needs turns or setup_turns and query")
        turns = [
            {"turn_id": f"turn-{i + 1:02d}", "prompt": prompt}
            for i, prompt in enumerate([*setup, case["query"]])
        ]
    if (
        not isinstance(turns, list)
        or not turns
        or any(
            not isinstance(t, dict)
            or any(not isinstance(t.get(k), str) or not t[k].strip() for k in ("prompt", "turn_id"))
            for t in turns
        )
    ):
        raise ValueError("Every turn needs a prompt and turn_id")
    if len({t["turn_id"] for t in turns}) != len(turns):
        raise ValueError("Duplicate turn_id")
    case["turns"] = turns
    return case


def read_cases(path: str) -> list[dict]:
    value = json.loads(Path(path).read_text())
    if not isinstance(value, dict) or value.get("schema_version") not in (
        "agent_routing_eval_cases.v1",
        "agent_eval_cases.v1",
    ):
        raise ValueError("Unsupported case schema")
    if not isinstance(value.get("cases"), list) or not value["cases"]:
        raise ValueError("Expected a nonempty cases list")
    cases = [normalize_case(case) for case in value["cases"]]
    if len({c["case_id"] for c in cases}) != len(cases):
        raise ValueError("Duplicate case_id")
    return cases


def sample(case, session=None):
    body = {"case": case}
    if session is not None:
        body["session"] = session
    return Sample(
        id=case["case_id"],
        input=json.dumps(body, ensure_ascii=False),
        target=case.get("reference", ""),
        metadata={"case_id": case["case_id"]},
    )


def case_dataset(path: str) -> MemoryDataset:
    return MemoryDataset([sample(case) for case in read_cases(path)])


def saved_dataset(path: str) -> MemoryDataset:
    value = json.loads(Path(path).read_text())
    if not isinstance(value, dict) or value.get("schema_version") not in (
        "agent_product_eval_result.v3",
        "agent_eval_sessions.v1",
    ):
        raise ValueError("Expected saved product results, not scores")
    if not isinstance(value.get("items"), list) or not value["items"]:
        raise ValueError("Expected a nonempty items list")
    samples = []
    for item in value["items"]:
        case = normalize_case(item["case"])
        if value["schema_version"] == "agent_product_eval_result.v3":
            fields = (
                "answer",
                "request_id",
                "conversation_id",
                "retrieved_contexts",
                "retrieved_context_ids",
                "cited_contexts",
                "cited_context_ids",
                "tool_trajectory",
                "request_time",
            )
            turn = {
                **{k: item[k] for k in fields if k in item},
                "turn_id": case["turns"][-1]["turn_id"],
                "user_prompt": case["query"],
                "status": "completed",
                "stages": [],
                "tools": [],
                "coverage": {"stages": "missing", "timing": "missing", "tools": "partial"},
            }
            session = {
                "turns": [turn],
                "complete": len(case["turns"]) == 1,
                "expected_turns": len(case["turns"]),
            }
        else:
            session = item["session"]
        if (
            not isinstance(session, dict)
            or not isinstance(session.get("turns"), list)
            or not session["turns"]
        ):
            raise ValueError("Saved session must contain observed turns")
        expected = [t["turn_id"] for t in case["turns"]]
        observed = [t.get("turn_id") for t in session["turns"]]
        if len(set(observed)) != len(observed) or any(t not in expected for t in observed):
            raise ValueError("Invalid saved turn identity")
        if session.get("complete") and observed != expected:
            raise ValueError("Complete session must contain every expected turn in order")
        samples.append(sample(case, session))
    if len({s.id for s in samples}) != len(samples):
        raise ValueError("Duplicate sample identity")
    return MemoryDataset(samples)
