# Based test development

Apply to tests and test infrastructure development.

## Document and test development

- Treat each standing-document behavior and its mapped tests as one specification unit.
- Write or update tests alongside the standing-document updates they map to after planning completes.
- Use an existing requirement identifier for the mapping when the project defines one. Otherwise identify the standing document, heading, and behavior that the test covers.
- Keep the mapping where a project reader can inspect it from the standing document or test.
- Cover each documented observable behavior with automated tests. State the manual validation procedure and limit in the standing document when automation cannot exercise the behavior.
- Update the plan, standing-document behavior, mapping, and tests together when the intended behavior changes.
- Obtain user confirmation of the revised plan and standing-document updates before implementing behavior that the standing documents do not define.

## Test-driven development

For each standing-document behavior:

1. Write or update its mapped test alongside the standing-document update.
2. Run the test and confirm that it fails for the expected missing behavior.
3. Record the mapped test and expected failure in the plan.
4. After user confirmation, add the smallest production implementation that makes the test pass.
5. Run the affected tests and confirm that they pass.
6. Refactor the tests and production implementation while the tests remain passing.

For a refactor that preserves documented behavior, run the mapped tests before and after the production implementation change. Do not add behavior to justify a new test.

## Test scope

- Test confirmed standing-document behaviors. Do not derive requirements from the current implementation.
- Assert on observable behavior and state, not log output or incidental implementation structure.
- Test error behavior, compatibility guarantees, and boundary conditions when the standing document defines them.

## Test cases

- Store standalone test files under `tests/`.
- Separate arrange, act, and assert sections with one blank line.
- Assert setup preconditions before assertions on the behavior under test.
- Name each test case `<outcome><condition>`.
- Combine cases that verify the same outcome into one data-driven suite. Name the suite for the outcome and each case for its condition.

## Test doubles

- Substitute a dependency through its declared interface.
- Define a test double only when a test must observe or control interaction through that interface.
- Group reusable mocks, fakes, and stubs by the production component whose interface they implement.
- Use the selected test framework's test-double mechanism when it preserves the interface contract.
