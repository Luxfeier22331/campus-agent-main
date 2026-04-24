from __future__ import annotations

from campus_contracts import ErrorInfo


class SupervisorError(ValueError):
    error_code = "supervisor_error"
    http_status_code = 500
    retryable = False

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message

    def to_error_info(self) -> ErrorInfo:
        return ErrorInfo(
            code=self.error_code,
            message=self.message,
            retryable=self.retryable,
        )


class InvalidSupervisorRequestError(SupervisorError):
    error_code = "invalid_supervisor_request"
    http_status_code = 400


class MissingRoutingInputError(InvalidSupervisorRequestError):
    error_code = "missing_routing_input"


class UnsupportedCapabilityError(InvalidSupervisorRequestError):
    error_code = "unsupported_capability"


class ExecutionCancelledError(SupervisorError):
    error_code = "execution_cancelled"
    http_status_code = 499


class DisallowedKnowledgeScopeError(SupervisorError):
    error_code = "disallowed_knowledge_scope"
    http_status_code = 403


class MissingSpecialistDelegateError(SupervisorError):
    error_code = "missing_specialist_delegate"
    http_status_code = 500


class InvalidSpecialistToolPolicyError(InvalidSupervisorRequestError):
    error_code = "invalid_specialist_tool_policy"
