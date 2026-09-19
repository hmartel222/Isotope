import { NotImplementedStageError, type DraftSpec, type LoadSelectedSpecs, type NormalizeFixtures } from '@isotope/core';

export const loadSelectedSpecs: LoadSelectedSpecs = (_input) => { throw new NotImplementedStageError('changespec.loadSelectedSpecs'); };
export const draftSpec: DraftSpec = (_input) => { throw new NotImplementedStageError('changespec.draftSpec'); };
export const normalizeFixtures: NormalizeFixtures = (_input) => { throw new NotImplementedStageError('changespec.normalizeFixtures'); };
