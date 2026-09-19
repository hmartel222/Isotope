import { NotImplementedStageError, type RenderReport } from '@isotope/core';

export const renderReport: RenderReport = (_input) => { throw new NotImplementedStageError('reporter.renderReport'); };
