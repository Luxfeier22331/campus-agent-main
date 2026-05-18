from __future__ import annotations

import inspect
import unittest


class RagAgentsSdkConformanceTest(unittest.TestCase):
    def test_locked_agents_sdk_exposes_required_agent_runner_tool_api(self) -> None:
        import agents
        from agents import Agent, FunctionTool, ModelSettings, RunConfig, Runner

        self.assertEqual(getattr(agents, "__version__", ""), "0.14.8")
        self.assertIn("output_type", inspect.signature(Agent).parameters)
        self.assertIn("tools", inspect.signature(Agent).parameters)
        self.assertIn("model_settings", inspect.signature(Agent).parameters)
        self.assertIn("max_turns", inspect.signature(Runner.run_sync).parameters)
        self.assertIn("context", inspect.signature(Runner.run_sync).parameters)
        self.assertIn("strict_json_schema", inspect.signature(FunctionTool).parameters)
        self.assertIn("timeout_behavior", inspect.signature(FunctionTool).parameters)
        self.assertIn("parallel_tool_calls", inspect.signature(ModelSettings).parameters)
        self.assertIn("tool_choice", inspect.signature(ModelSettings).parameters)
        self.assertIn("tracing_disabled", inspect.signature(RunConfig).parameters)
        self.assertIn("trace_include_sensitive_data", inspect.signature(RunConfig).parameters)


if __name__ == "__main__":
    unittest.main()
