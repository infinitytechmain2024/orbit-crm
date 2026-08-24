from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from backend.config import Settings


class SettingsTests(unittest.TestCase):
    def test_rejects_mismatched_supabase_project(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://oldproject.supabase.co",
                "EXPECTED_SUPABASE_PROJECT_REF": "currentproject",
            },
            clear=False,
        ):
            with self.assertRaises(ValidationError):
                Settings(_env_file=None)

    def test_accepts_matching_supabase_project(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://currentproject.supabase.co",
                "EXPECTED_SUPABASE_PROJECT_REF": "currentproject",
            },
            clear=False,
        ):
            configured = Settings(_env_file=None)
        self.assertEqual(configured.EXPECTED_SUPABASE_PROJECT_REF, "currentproject")


if __name__ == "__main__":
    unittest.main()
