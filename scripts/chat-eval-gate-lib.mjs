import {
  deriveTurnVerificationExpectation,
  establishedNothing,
  qualitativeScores,
  sanitizeEvidence,
  validateAbstainedCounterfactualDiscipline,
  validateAnalystExpression,
  validateAnswerCopy,
  validateAnswerStructure,
  validateCitationContract,
  validateDatedClubNewsConsistency,
  validateGrounding,
  validateNoDraftLeak,
  validatePositiveCurrentManager,
  validatePositiveDatedClubNews,
  validateResponseCorrectness,
  validateTeamNewsDiscipline,
  validateVerification,
} from "./chat-battle-test-lib.mjs";

export function gradeRecordedJsonScenario(scenario, recordedTurns, { evaluationNow = Date.now() } = {}) {
  const result = {
    id: scenario.id,
    passed: false,
    outcome: "FAIL",
    assertions: {},
    answer: null,
    grounding: undefined,
    citations: [],
    verification: null,
    turnResults: [],
    evidence: "",
    correctnessCertified: false,
    qualitativeScores: null,
  };
  const history = [];
  const assertionFailures = [];
  let semanticCheckCount = 0;

  for (const [turnIndex, turn] of scenario.turns.entries()) {
    const recorded = recordedTurns[turnIndex];
    if (!recorded) {
      assertionFailures.push(`turn ${turnIndex + 1}: missing recorded response`);
      break;
    }
    const turnNumber = turnIndex + 1;
    const grounding = recorded.grounding ?? null;
    const answer = typeof recorded.answer === "string" ? recorded.answer : "";
    const citations = Array.isArray(recorded.citations) ? recorded.citations : [];
    const verification = recorded.verification ?? null;

    result.answer = answer;
    result.citations = citations;
    result.verification = verification;
    result.grounding = grounding;

    const groundingValidation = validateGrounding(grounding, {
      ...turn,
      expectOddsSources: Boolean(turn.expectOddsSources),
    });
    for (const [name, passed] of Object.entries(groundingValidation.assertions)) {
      result.assertions[`turn${turnNumber}${name[0].toUpperCase()}${name.slice(1)}`] = passed;
    }

    if (!answer.trim()) {
      assertionFailures.push(`turn ${turnNumber}: empty answer`);
      break;
    }

    history.push({ role: "user", content: turn.question }, { role: "assistant", content: answer });

    const copyValidation = validateAnswerCopy(answer, {
      grounding: grounding?.kind === "match" ? grounding : undefined,
    });
    result.assertions.plainLanguageCopy = copyValidation.passed;
    const structureValidation = validateAnswerStructure(answer, {
      expectHeadlineOneXTwo: grounding?.kind === "match"
        && Boolean(turn.expectHeadlineOneXTwo ?? scenario.expectHeadlineOneXTwo),
      grounding: grounding?.kind === "match" ? grounding : undefined,
    });
    Object.assign(result.assertions, structureValidation.assertions);

    const citationRequired = Boolean(turn.requireCitation || scenario.requireCitation)
      && !establishedNothing(verification);
    const citationValidation = validateCitationContract(answer, citations, citationRequired);
    const verificationExpectation = deriveTurnVerificationExpectation(verification, scenario, turn);
    const verificationValidation = validateVerification(verification, verificationExpectation);

    if (turn.expectCurrentManager) {
      const scope = {
        team: turn.expectCurrentManager.team.replaceAll("{home}", scenario.__home ?? turn.expectCurrentManager.team),
      };
      const positiveManager = validatePositiveCurrentManager(
        answer,
        citations,
        verification,
        scope,
        evaluationNow
      );
      semanticCheckCount += Object.keys(positiveManager.assertions).length;
      for (const [name, passed] of Object.entries(positiveManager.assertions)) {
        result.assertions[`turn${turnNumber}${name[0].toUpperCase()}${name.slice(1)}`] = passed;
      }
      assertionFailures.push(...positiveManager.failures.map((failure) => `turn ${turnNumber}: ${failure}`));
    }

    for (const [name, passed] of Object.entries(verificationValidation.assertions)) {
      result.assertions[`turn${turnNumber}${name[0].toUpperCase()}${name.slice(1)}`] = passed;
    }
    assertionFailures.push(...verificationValidation.failures.map((failure) => `turn ${turnNumber}: ${failure}`));

    for (const [name, passed] of Object.entries(citationValidation.assertions)) {
      result.assertions[`turn${turnNumber}${name[0].toUpperCase()}${name.slice(1)}`] = passed;
    }
    const draftValidation = validateNoDraftLeak(answer);
    result.assertions.noDraftLeak = draftValidation.passed;

    assertionFailures.push(...structureValidation.failures.map((failure) => `turn ${turnNumber}: ${failure}`));
    assertionFailures.push(...copyValidation.failures.map((failure) => `turn ${turnNumber}: ${failure}`));

    const expressionValidation = validateAnalystExpression(answer, { ...scenario, ...turn }, grounding);
    semanticCheckCount += Object.keys(expressionValidation.assertions).length;
    for (const [name, passed] of Object.entries(expressionValidation.assertions)) {
      result.assertions[`turn${turnNumber}${name[0].toUpperCase()}${name.slice(1)}`] = passed;
    }
    assertionFailures.push(...expressionValidation.failures.map((failure) => `turn ${turnNumber}: ${failure}`));
    assertionFailures.push(...citationValidation.failures.map((failure) => `turn ${turnNumber}: ${failure}`));
    assertionFailures.push(...draftValidation.failures.map((failure) => `turn ${turnNumber}: ${failure}`));
    assertionFailures.push(...groundingValidation.failures.map((failure) => `turn ${turnNumber}: ${failure}`));

    const correctnessValidation = validateResponseCorrectness(answer, citations, grounding, { ...scenario, ...turn });
    semanticCheckCount += Object.keys(correctnessValidation.assertions).length;
    for (const [name, passed] of Object.entries(correctnessValidation.assertions)) {
      result.assertions[`turn${turnNumber}${name[0].toUpperCase()}${name.slice(1)}`] = passed;
    }
    assertionFailures.push(...correctnessValidation.failures.map((failure) => `turn ${turnNumber}: ${failure}`));

    const abstentionValidation = validateAbstainedCounterfactualDiscipline(
      answer,
      verificationExpectation.guardUnsupportedConflictCounterfactuals ? "abstain" : verification?.status
    );
    semanticCheckCount += Object.keys(abstentionValidation.assertions).length;
    for (const [name, passed] of Object.entries(abstentionValidation.assertions)) {
      result.assertions[`turn${turnNumber}${name[0].toUpperCase()}${name.slice(1)}`] = passed;
    }
    assertionFailures.push(...abstentionValidation.failures.map((failure) => `turn ${turnNumber}: ${failure}`));

    if (verificationExpectation.requireSourcedTeamNews) {
      const newsValidation = validateTeamNewsDiscipline(answer);
      result.assertions[`turn${turnNumber}TeamNewsSourced`] = newsValidation.passed;
      semanticCheckCount += 1;
      assertionFailures.push(...newsValidation.failures.map((failure) =>
        `turn ${turnNumber}: ${failure} — ${sanitizeEvidence(answer)}`
      ));
    }
    if (verificationExpectation.requirePositiveDatedClubNews) {
      const positiveNews = validatePositiveDatedClubNews(answer, citations, verification, evaluationNow);
      for (const [name, passed] of Object.entries(positiveNews.assertions)) {
        result.assertions[`turn${turnNumber}${name[0].toUpperCase()}${name.slice(1)}`] = passed;
      }
      semanticCheckCount += Object.keys(positiveNews.assertions).length;
      assertionFailures.push(...positiveNews.failures.map((failure) => `turn ${turnNumber}: ${failure}`));
    }
    if (verificationExpectation.requireDatedClubNewsConsistency) {
      const newsConsistency = validateDatedClubNewsConsistency(answer, citations, verification, evaluationNow);
      for (const [name, passed] of Object.entries(newsConsistency.assertions)) {
        result.assertions[`turn${turnNumber}${name[0].toUpperCase()}${name.slice(1)}`] = passed;
      }
      semanticCheckCount += Object.keys(newsConsistency.assertions).length;
      assertionFailures.push(...newsConsistency.failures.map((failure) => `turn ${turnNumber}: ${failure}`));
    }

    result.turnResults.push({
      turn: turnNumber,
      request: recorded.request ?? { question: turn.question },
      status: recorded.status ?? 200,
      grounding,
      citations,
      verification,
      answer,
      assertions: Object.fromEntries(
        Object.entries(result.assertions).filter(([name]) => name.startsWith(`turn${turnNumber}`))
      ),
    });
  }

  result.passed = assertionFailures.length === 0 && Object.values(result.assertions).every(Boolean);
  result.correctnessCertified = result.passed && semanticCheckCount > 0;
  result.outcome = result.passed ? "PASS" : "FAIL";
  result.evidence = result.passed
    ? `${scenario.turns.length} turn(s) revalidated from pinned fixture.`
    : assertionFailures.join("; ");
  result.qualitativeScores = qualitativeScores(result);
  return result;
}
