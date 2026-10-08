import tempfile, unittest
from pathlib import Path
from gliner_onnx.clinical_release import load_release


class ClinicalRelease(unittest.TestCase):
    def test_unreviewed_helper_is_rejected_before_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / "executed"
            (root / "usage.py").write_text(
                f"from pathlib import Path\nPath({str(marker)!r}).touch()\n"
            )
            with self.assertRaisesRegex(ValueError, "reviewed runtime"):
                load_release(root, root, root, "fastino/gliner2.5-base-v1", "a" * 40)
            self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
