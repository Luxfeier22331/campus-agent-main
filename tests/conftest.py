from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
FIXTURES = ROOT / "tests" / "fixtures"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


def sample_canonical_headers() -> dict[str, object]:
    return {
        "authorization": "Bearer bootstrap-token",
        "trace_id": "trace-001",
        "parent_run_id": "run-parent-001",
        "tool_call_id": "tool-call-001",
        "caller_service": "campus-agent",
        "actor_user_id": "user-123",
        "actor_roles": ["student", "member"],
        "actor_departments": ["cs"],
        "actor_groups": ["library-users"],
        "campus_scope": "main-campus",
        "actor_snapshot": {"cohort": "grad"},
    }


def sample_search_payload() -> dict[str, object]:
    return {
        "query": "library hours",
        "corpora": ["student_handbook"],
        "filters": {"audience": "student"},
        "debug": False,
    }


def sample_answer_payload() -> dict[str, object]:
    return {
        "query": "Where is the library service desk?",
        "corpora": ["student_handbook"],
        "filters": {"audience": "student"},
        "debug": False,
    }


def runtime_detail_error_response() -> dict[str, object]:
    return {
        "detail": {
            "code": "unknown_corpora",
            "message": "Unknown corpora requested: handbook",
            "retryable": False,
        },
        "request_id": "req_unknown_corpora",
    }


def directory_fixture_path() -> Path:
    return FIXTURES / "directory" / "directory_records.json"


def map_fixture_path() -> Path:
    return FIXTURES / "map" / "map_records.json"
