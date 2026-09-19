import { describe, expect, it } from 'vitest';
import { resolveTreatment } from '../../src/adapters/treatment.js';

describe('graph experiment treatment preflight', () => {
  it('accepts all ablation arms while retaining model launch settings', () => {
    for (let mask = 0; mask < 8; mask++) {
      expect(resolveTreatment({model: 'gpt-5.6-sol', reasoningEffort: 'medium', graphMinimumNodes: 1,
        taskGraphExperiments: {decisionContinuations: !!(mask & 4), semanticPartitioning: !!(mask & 2), questionGraph: !!(mask & 1)}}))
        .toEqual({model: 'gpt-5.6-sol', thinkingConfig: {enabled: true, effort: 'medium', display: 'summarized'}});
    }
  });
  it('rejects malformed experiment settings instead of silently changing arms', () => {
    for (const value of [null, [], true, {questionGraph: 'true'}, {questionGraphs: true}]) {
      expect(() => resolveTreatment({taskGraphExperiments: value})).toThrow(/taskGraphExperiments/);
    }
    expect(() => resolveTreatment({graphMinimumNodes: 0})).toThrow(/graphMinimumNodes/);
    expect(() => resolveTreatment({unknownTreatment: true})).toThrow(/unsupported treatment/);
  });
});
