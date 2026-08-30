import { test, expect } from "@playwright/test";

import {
  asFindings,
  asPlanSteps,
  asRecord,
  asString,
} from "../src/features/ai-workflow/autopilot-result";

/**
 * Logic tests for the autopilot panel's defensive parsers.
 *
 * `ai_tasks.result` is untyped JSON written by the backend, and rows predating
 * the autopilot lifecycle have none of these fields. An exception in this
 * parsing would take down the whole task dialog, so the malformed cases are
 * covered explicitly.
 *
 * These live under e2e/ only because Playwright is the project's sole TypeScript
 * test runner; they never open a browser.
 */

test.describe("AutopilotRunPanel parsing", () => {
  test("asRecord accepts only plain objects", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    for (const value of [null, undefined, [], "str", 42, true]) {
      expect(asRecord(value)).toBeNull();
    }
  });

  test("asString never returns a non-string", () => {
    expect(asString("ok")).toBe("ok");
    for (const value of [null, undefined, 42, {}, []]) {
      expect(asString(value)).toBe("");
    }
  });

  test("plan steps survive missing and malformed entries", () => {
    const steps = asPlanSteps([
      { id: "1", title: "Ручка", status: "done", note: "готово" },
      { id: "2", title: "Кнопка" },
      { id: "3" },
      { title: "" },
      "not an object",
      null,
    ]);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ id: "1", title: "Ручка", status: "done", note: "готово" });
    // A step with no status must read as pending, not as done.
    expect(steps[1]).toMatchObject({ id: "2", status: "pending" });
  });

  test("plan steps tolerate a non-array", () => {
    for (const value of [null, undefined, {}, "steps"]) {
      expect(asPlanSteps(value)).toEqual([]);
    }
  });

  test("findings drop entries with no summary and default the severity", () => {
    const findings = asFindings([
      { severity: "blocker", summary: "битый импорт", file: "x.py" },
      { summary: "без severity" },
      { severity: "major" },
      42,
    ]);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ severity: "blocker", file: "x.py" });
    expect(findings[1]).toMatchObject({ severity: "minor", summary: "без severity" });
  });

  test("findings tolerate a non-array", () => {
    for (const value of [null, undefined, {}, "findings"]) {
      expect(asFindings(value)).toEqual([]);
    }
  });
});
