# E2E & Integration Test Readiness Report (TEST_READY.md)

This document certifies that the End-to-End (E2E) and Integration testing suite for the `ambient-agent` project has been fully implemented, verified, and all tests are passing.

---

## 1. Test Suite Coverage Summary

We have created and updated test cases covering the following key workflows:

### A. Early Morning Briefing Skip Logic (`cf-worker/test/e2e/workflow.test.ts`)
- **Weekday Execution**: Verifies that scheduled jobs at JST 05:30 (UTC 20:30) trigger the daily briefing on regular weekdays.
- **Weekend Skip**: Simulates a Sunday scheduled run and ensures that briefing notifications are skipped.
- **Public Holiday Skip**: Mocks the Japanese Public Holidays API response (`holidays-jp.github.io`) and verifies that when JST 05:30 scheduled event fires on a public holiday (e.g. 元日 2026-01-01), the daily briefing is correctly skipped.

### B. Location-Based Task Filtering (`cf-worker/test/e2e/workflow.test.ts`)
- **Forced Extraction**: Ensures tasks containing location keywords such as `"home"`, `"自宅"`, `"家"` are forced-extracted during the `/home-arrival` trigger, and `"office"`, `"オフィス"`, `"会社"`, `"職場"` during `/office-leave` trigger.
- **Case-Insensitivity & Name Variations**: Confirms that mixed-case keywords (e.g., `"Home"`, `"Office"`) and language variants are correctly matched.
- **Deduplication**: Validates that rule-based matching and Gemini-extracted selections are merged, and any duplicate titles are successfully pruned.
- **No Tasks Behavior**: Verifies that when no tasks are found or selected, a polite Telegram notification (`"該当するタスクはありません。お疲れ様でした！"`) is sent.

### C. Separation of Judgment Logic (`cf-worker/test/e2e/workflow.test.ts`)
- **Dependency Injection**: Asserts that `runNotificationTrigger` correctly coordinates the workflow (fetching Notion, calling holiday checks, executing decision function) and uses the injected selection logic rather than hardcoding specific logic inside the coordinator.

### D. Scheduled Job Cron Fix (`cf-worker/test/integration/scheduled.test.ts`)
- **Bug Resolution**: Corrected the outdated cron expression on line 133 from `"0 23 * * *"` to `"30 20 * * *"` to match the JST 05:30 cron configured in `src/index.ts`.

---

## 2. Test Execution Results

All unit, integration, and E2E tests have been run successfully in both worktree workspaces:
- Local worktree: `/home/ctoshiki/dev/ambient-agent-e2e-v2`
- Implementation worktree: `/home/ctoshiki/dev/ambient-agent-wt`

### Summary Table
| File Category | Total Test Files | Total Test Cases | Status |
| :--- | :---: | :---: | :---: |
| Unit Tests | 21 | 213 | **PASSED** |
| Integration Tests | 5 | 22 | **PASSED** |
| E2E Tests | 1 | 7 | **PASSED** |
| **Total** | **27** | **242** | **ALL PASSED** |

### Execution Logs
```bash
 Test Files  27 passed (27)
      Tests  242 passed (242)
   Start at  20:46:27
   Duration  6.26s
```
All assertions verified:
- Date/Time mocking successfully controlled JST/UTC transition.
- In-memory KV namespace mock and D1 mock state correctly tracked.
- Telegram/Gemini/Notion client responses successfully stubbed to match real-world API formats.
- Error notification pathways fully covered.
