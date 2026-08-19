/**
 * Types for the plain-ESM battle-harness validators.
 *
 * `scripts/chat-battle-test-lib.mjs` is the single definition of what a
 * delivered answer has to look like, and it is deliberately imported here
 * rather than re-implemented: a copy of a validator inside the API test suite
 * rots the moment the harness learns a new failure shape, and the two then
 * disagree about whether an answer is shippable.
 */
declare module "*/chat-battle-test-lib.mjs" {
  export function validateAnswerStructure(
    answer: string,
    expectation?: { expectHeadlineOneXTwo?: boolean }
  ): { passed: boolean; assertions: Record<string, boolean>; failures: string[] };
  export function validateAnswerCopy(
    answer: string
  ): { passed: boolean; failures: string[] };
  export function validateNoDraftLeak(
    answer: string
  ): { passed: boolean; failures: string[] };
  export function validateTeamNewsDiscipline(
    answer: string
  ): { passed: boolean; assertions: Record<string, boolean>; failures: string[] };
}
