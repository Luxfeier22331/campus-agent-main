from __future__ import annotations

import unittest

from scripts.check_repo_static import affected_repo_static_checks


class CheckRepoStaticTest(unittest.TestCase):
    def test_affected_checks_skip_java_and_docker_for_frontend_changes(self) -> None:
        checks = affected_repo_static_checks(
            (
                "apps/campus-web/src/features/conversation/assistant-ui-runtime.tsx",
                "apps/campus-web/e2e/qa.spec.ts",
            ),
            py="python",
        )

        labels = tuple(check.label for check in checks)

        self.assertIn("biome affected files", labels)
        self.assertIn("decomposition", labels)
        self.assertNotIn("java tracked files", labels)
        self.assertNotIn("docker affected files", labels)

    def test_affected_checks_include_java_for_legacy_office_changes(self) -> None:
        checks = affected_repo_static_checks(
            ("apps/legacy-office-conversion-service/src/main/java/Foo.java",),
            py="python",
        )

        labels = tuple(check.label for check in checks)

        self.assertIn("java tracked files", labels)

    def test_affected_checks_include_docker_for_dockerfile_changes(self) -> None:
        checks = affected_repo_static_checks(
            ("apps/legacy-office-conversion-service/Dockerfile",),
            py="python",
        )

        labels = tuple(check.label for check in checks)

        self.assertIn("docker affected files", labels)


if __name__ == "__main__":
    unittest.main()
