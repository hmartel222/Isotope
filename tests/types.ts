import type { Confidence, Verdict, Signature, CandidatePatch, IsotopeConfig, CodeVersion, BDGNode, JsonValue } from '@isotope/core';
const verdict: Verdict = 'PASS_REASONED';
const confidence: Confidence = 'medium';
const codeVersion: CodeVersion = 'patched:r1';
// @ts-expect-error unknown verdicts must fail at compile time too
const wrongVerdict: Verdict = 'SUCCESS';
// @ts-expect-error confidence is a literal union, not string
const wrongConfidence: Confidence = 'certain';
// @ts-expect-error versions distinguish original from patched:<id>
const wrongVersion: CodeVersion = 'modified';
// @ts-expect-error missing required entryPointId
const incompleteSignature: Signature = { codeVersion: 'original' };
// @ts-expect-error repair classifications are frozen
const wrongClassification: CandidatePatch['classification'] = 'verified';
// @ts-expect-error repair verification cannot be disabled
const invalidVerify: IsotopeConfig['repair']['verify'] = false;
// @ts-expect-error node kinds are frozen
const wrongNode: BDGNode['kind'] = 'function';
// @ts-expect-error runtime JSON must not contain undefined
const invalidJson: JsonValue = undefined;
void [verdict, confidence, codeVersion, wrongVerdict, wrongConfidence, wrongVersion, incompleteSignature, wrongClassification, invalidVerify, wrongNode, invalidJson];
