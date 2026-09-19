/** Bit order: decision continuations, semantic partitioning, question graph. */
export function experimentTreatment(variant) {
  const match = /^experiments-([01])([01])([01])$/.exec(variant);
  return {
    decisionContinuations: match?.[1] === '1',
    semanticPartitioning: match?.[2] === '1',
    questionGraph: match?.[3] === '1',
  };
}
export function isExperimentVariant(variant) { return /^experiments-[01]{3}$/.test(variant); }
