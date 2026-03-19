"""Bootstrap package for the campus workflow-first entry agent."""

from campus_agent.config import CampusAgentSettings
from campus_agent.workflows import CampusWorkflow

__all__ = ["CampusAgentSettings", "CampusWorkflow"]

__version__ = "0.1.0"

