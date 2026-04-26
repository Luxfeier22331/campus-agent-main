from .file_asset_substrate_support import *


class FileAssetHardeningContractTest(unittest.TestCase):
    def test_ingestion_core_dependencies_do_not_reintroduce_xlrd(self) -> None:
        pyproject_path = (
            Path(__file__).resolve().parents[2] / "packages/ingestion-core/pyproject.toml"
        )
        payload = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))

        dependencies = tuple(str(item) for item in payload["project"]["dependencies"])
        self.assertFalse(any(dep.startswith("xlrd") for dep in dependencies))

    def test_forward_substrate_does_not_keep_retired_compatibility_shims(self) -> None:
        root = Path(__file__).resolve().parents[2]

        self.assertFalse(
            (
                root / "packages/ingestion-core/src/campus_ingestion_core/raw_asset_typing.py"
            ).exists()
        )
        self.assertFalse(
            (
                root / "packages/ingestion-core/src/campus_ingestion_core/online_ocr_routing.py"
            ).exists()
        )
