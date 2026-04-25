from __future__ import annotations

from campus_contracts import ErrorInfo


class AgentDispatchError(ValueError):
    error_code = "agent_dispatch_error"
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


class ExecutionCancelledError(AgentDispatchError):
    error_code = "execution_cancelled"
    http_status_code = 499


class MissingAgentDelegateError(AgentDispatchError):
    error_code = "missing_agent_delegate"
    http_status_code = 500
