from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.services import autopilot_plan
from backend.services.autopilot_plan import (
    STATUS_BLOCKED,
    STATUS_DONE,
    STATUS_PENDING,
    AutopilotPlan,
    PlanStep,
)


def _plan() -> AutopilotPlan:
    return AutopilotPlan(
        task_id="task-42",
        task_title="Добавить экспорт клиентов",
        goal="Пользователь может выгрузить клиентов в CSV",
        steps=[
            PlanStep(id="1", title="Ручка бэкенда", detail="backend/routers/company_router.py"),
            PlanStep(id="2", title="Кнопка на фронте", detail="src/routes/clients.tsx"),
            PlanStep(id="3", title="Тесты"),
        ],
    )


class PlanRenderingTests(unittest.TestCase):
    def test_render_parse_roundtrip_preserves_statuses(self):
        plan = _plan()
        plan.mark("1", STATUS_DONE, "готово, добавил /clients/export")
        plan.mark("2", STATUS_BLOCKED, "нет дизайна кнопки")

        restored = autopilot_plan.parse(plan.render(), task_id=plan.task_id, task_title=plan.task_title)

        self.assertEqual([step.id for step in restored.steps], ["1", "2", "3"])
        self.assertEqual(restored.find("1").status, STATUS_DONE)
        self.assertEqual(restored.find("2").status, STATUS_BLOCKED)
        self.assertEqual(restored.find("3").status, STATUS_PENDING)
        self.assertEqual(restored.find("2").note, "нет дизайна кнопки")
        self.assertEqual(restored.find("1").detail, "backend/routers/company_router.py")
        self.assertEqual(restored.goal, plan.goal)

    def test_counts_track_progress(self):
        plan = _plan()
        self.assertEqual(plan.counts(), {"total": 3, "done": 0, "blocked": 0, "pending": 3})
        plan.mark("1", STATUS_DONE)
        plan.mark("2", STATUS_BLOCKED, "внешняя зависимость")
        self.assertEqual(plan.counts(), {"total": 3, "done": 1, "blocked": 1, "pending": 1})
        self.assertEqual([step.id for step in plan.pending], ["3"])

    def test_mark_unknown_step_returns_none_and_changes_nothing(self):
        plan = _plan()
        self.assertIsNone(plan.mark("99", STATUS_DONE))
        self.assertEqual(plan.counts()["done"], 0)

    def test_plan_file_lands_in_the_documented_directory(self):
        plan = _plan()
        self.assertTrue(plan.relative_path.startswith("docs/autopilot/plans/"))
        self.assertTrue(plan.relative_path.endswith(".md"))
        # Title slug must be filesystem-safe even for punctuation-heavy titles.
        noisy = AutopilotPlan(task_id="t/1", task_title="Релиз?! v2 — «срочно»")
        self.assertNotIn(" ", noisy.relative_path)
        for char in ("?", "!", "«", "»", "—"):
            self.assertNotIn(char, noisy.relative_path)

    def test_write_creates_parents_and_persists_progress(self):
        with tempfile.TemporaryDirectory() as tmp:
            workdir = Path(tmp)
            plan = _plan()
            plan.mark("1", STATUS_DONE)
            written = plan.write(workdir)

            self.assertTrue(written.is_file())
            self.assertEqual(written, workdir / plan.relative_path)
            body = written.read_text(encoding="utf-8")
            self.assertIn("- [x] 1. Ручка бэкенда", body)
            self.assertIn("- [ ] 3. Тесты", body)
            self.assertIn("1/3 выполнено", body)


class PlanBuildingTests(unittest.TestCase):
    TASK = {
        "id": "task-7",
        "title": "Починить логин",
        "acceptance_criteria": ["Форма отправляется", "Ошибка показывается"],
    }

    def test_build_plan_from_model_payload(self):
        plan = autopilot_plan.build_plan(
            self.TASK,
            {
                "goal": "Логин работает",
                "steps": [
                    {"title": "Найти обработчик", "detail": "src/lib/auth.tsx"},
                    {"title": "Починить submit"},
                    {"title": "Прогнать e2e"},
                ],
            },
        )
        self.assertEqual([step.id for step in plan.steps], ["1", "2", "3"])
        self.assertEqual(plan.steps[0].detail, "src/lib/auth.tsx")
        self.assertEqual(plan.goal, "Логин работает")

    def test_unusable_payload_falls_back_to_acceptance_criteria(self):
        for payload in (None, {}, {"steps": "не список"}, {"steps": [{"title": ""}]}):
            with self.subTest(payload=payload):
                plan = autopilot_plan.build_plan(self.TASK, payload)
                self.assertEqual(
                    [step.title for step in plan.steps],
                    ["Форма отправляется", "Ошибка показывается"],
                )

    def test_fallback_plan_without_criteria_still_has_steps(self):
        plan = autopilot_plan.fallback_plan({"id": "x", "title": "Что-то сделать"})
        self.assertGreaterEqual(len(plan.steps), autopilot_plan.MIN_STEPS)

    def test_step_count_is_capped(self):
        payload = {"steps": [{"title": f"Шаг {index}"} for index in range(50)]}
        plan = autopilot_plan.build_plan(self.TASK, payload)
        self.assertLessEqual(len(plan.steps), autopilot_plan.MAX_STEPS)


class JsonExtractionTests(unittest.TestCase):
    def test_extracts_object_from_fenced_and_chatty_answers(self):
        cases = [
            '{"steps": [{"title": "a"}]}',
            'Вот план:\n```json\n{"steps": [{"title": "a"}]}\n```\nГотово.',
            'Думаю... {"steps": [{"title": "a"}]} — как-то так',
        ]
        for text in cases:
            with self.subTest(text=text[:30]):
                self.assertEqual(autopilot_plan._extract_json_object(text), {"steps": [{"title": "a"}]})

    def test_returns_none_instead_of_raising_on_garbage(self):
        for text in ("", "нет json", "{не json}", "[1,2,3]"):
            with self.subTest(text=text):
                self.assertIsNone(autopilot_plan._extract_json_object(text))

    def test_braces_inside_strings_do_not_break_extraction(self):
        parsed = autopilot_plan._extract_json_object('{"goal": "исправить {curly} в шаблоне"}')
        self.assertEqual(parsed, {"goal": "исправить {curly} в шаблоне"})


class PlanGenerationTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_failure_never_aborts_the_run(self):
        async def boom(_messages):
            raise RuntimeError("provider down")

        plan = await autopilot_plan.generate(boom, PlanBuildingTests.TASK)
        self.assertGreaterEqual(len(plan.steps), autopilot_plan.MIN_STEPS)

    async def test_no_response_falls_back(self):
        async def nothing(_messages):
            return None

        plan = await autopilot_plan.generate(nothing, PlanBuildingTests.TASK)
        self.assertGreaterEqual(len(plan.steps), autopilot_plan.MIN_STEPS)

    async def test_planner_is_called_without_a_toolset(self):
        class Result:
            content = '{"goal": "g", "steps": [{"title": "a"}, {"title": "b"}]}'

        seen: list[list[dict]] = []

        async def complete(messages):
            seen.append(messages)
            return Result()

        plan = await autopilot_plan.generate(complete, PlanBuildingTests.TASK)
        self.assertEqual([step.title for step in plan.steps], ["a", "b"])
        self.assertEqual(seen[0][0]["role"], "system")


if __name__ == "__main__":
    unittest.main()
