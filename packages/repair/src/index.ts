import { NotImplementedStageError, type ApplyCandidatePatch, type CheckRepairEligibility, type PlanRepair } from '@isotope/core';

export const checkRepairEligibility: CheckRepairEligibility = (_input) => { throw new NotImplementedStageError('repair.checkRepairEligibility'); };
export const planRepair: PlanRepair = (_input) => { throw new NotImplementedStageError('repair.planRepair'); };
export const generateDeterministicCandidate: PlanRepair = (_input) => { throw new NotImplementedStageError('repair.generateDeterministicCandidate'); };
export const applyCandidatePatch: ApplyCandidatePatch = (_input) => { throw new NotImplementedStageError('repair.applyCandidatePatch'); };
