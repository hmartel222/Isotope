import type { BDG, CandidatePatch, ChangeSpec, CodeVersion, DiffReport, EntryPoint, EvidencePacket, IsotopeConfig, IsotopeReport, JsonValue, ReasoningResult, RepairPacket, RepairVerification, SelectedSpecs, Signature, VerifiedRepair, VerdictResult, VerdictReport } from './contracts';

export class NotImplementedStageError extends Error {
  readonly code = 'ISOTOPE_STAGE_NOT_IMPLEMENTED';
  constructor(readonly stage: string) {
    super(`${stage} is not implemented yet (Phase 1 contracts/scaffold only).`);
    this.name = 'NotImplementedStageError';
  }
}
export interface SelectionInput { repoRoot: string; config: IsotopeConfig; specsPath: string; dependencyDiff: string }
export interface ResolveInput { repoRoot: string; config: IsotopeConfig; selectedSpecs: SelectedSpecs }
export interface FixturePair { id: string; role: 'planning' | 'held_out'; oldPath: string; newPath: string; oldVersion: string; newVersion: string }
export interface HarnessInput { repoRoot: string; config: IsotopeConfig; entryPoint: EntryPoint; bdg: BDG; fixture: FixturePair; codeVersion: CodeVersion }
export interface HarnessResult { old: [Signature, Signature]; new: [Signature, Signature] }
export interface DiffInput { old: Signature; new: Signature; bdg: BDG; selfComparisons: { old: [Signature, Signature]; new: [Signature, Signature] } }
export interface ReasoningInput { packet: EvidencePacket; config: IsotopeConfig['reasoner'] }
export interface ReasoningRun { status: 'completed' | 'unavailable' | 'errored' | 'disagreed' | 'abstained'; results: ReasoningResult[]; packetRef: string; responseRefs: string[]; error?: string }
export interface VerdictInput { entryPoint: EntryPoint; bdg: BDG; diff: DiffReport; reasoning: ReasoningRun | null; config: IsotopeConfig }
export interface RepairEligibilityInput { verdict: VerdictResult; bdg: BDG; selectedSpecs: SelectedSpecs; config: IsotopeConfig; fixture: FixturePair }
export interface RepairEligibility { eligible: boolean; route: 'deterministic' | 'model' | 'none'; reason: string }
export interface RepairPlanInput { packet: RepairPacket; config: IsotopeConfig['repair'] }
export interface PatchApplicationInput { repoRoot: string; temporaryRoot: string; repairId: string; candidate: CandidatePatch; allowedPaths: string[]; maxFiles: number; maxChangedLines: number }
/** Future implementation must release the workspace in a finally block. */
export interface AppliedCandidate { repairId: string; workspaceRoot: string; diff: string; dispose(): Promise<void> }
export interface RepairVerificationInput { repairId: string; workspaceRoot: string; candidate: CandidatePatch; config: IsotopeConfig; selectedSpecs: SelectedSpecs; originalBDG: BDG; entryPoint: EntryPoint; originalVerdict: VerdictResult; planning: { fixture: FixturePair; original: HarnessResult }; heldOut: { fixture: FixturePair; original: HarnessResult } }
export interface RepairVerificationResult { verification: RepairVerification; verifiedRepair: VerifiedRepair | null }
export interface ReportOutput { markdown: string; report: IsotopeReport }
export interface FleetInput { repositories: { id: string; path: string }[]; selectedSpecs: SelectedSpecs; config: IsotopeConfig; outPath: string }
export interface FleetResult { reports: IsotopeReport[]; dashboardPath: string }
export interface NormalizeFixturesInput { rawDirectory: string; normalizedDirectory: string; pairId: string }
export interface DraftSpecInput { url: string; provider: string }

export type LoadSelectedSpecs = (input: SelectionInput) => Promise<SelectedSpecs>;
export type ResolveBehavioralDependencyGraph = (input: ResolveInput) => Promise<BDG>;
export type RunHarness = (input: HarnessInput) => Promise<HarnessResult>;
export type DiffSignatures = (input: DiffInput) => DiffReport;
export type ReasonAboutDivergence = (input: ReasoningInput) => Promise<ReasoningRun>;
export type ResolveVerdict = (input: VerdictInput) => VerdictResult;
export type ResolveAggregateVerdict = (results: VerdictResult[]) => VerdictReport;
export type CheckRepairEligibility = (input: RepairEligibilityInput) => RepairEligibility;
export type PlanRepair = (input: RepairPlanInput) => Promise<CandidatePatch>;
export type ApplyCandidatePatch = (input: PatchApplicationInput) => Promise<AppliedCandidate>;
export type VerifyRepair = (input: RepairVerificationInput) => Promise<RepairVerificationResult>;
export type RenderReport = (report: IsotopeReport) => ReportOutput;
export type RunFleet = (input: FleetInput) => Promise<FleetResult>;
export type DraftSpec = (input: DraftSpecInput) => Promise<ChangeSpec>;
export type NormalizeFixtures = (input: NormalizeFixturesInput) => Promise<{ pairId: string; metadata: JsonValue }>;

// L6 belongs here per v3 §2.5; placeholders contain no resolution/business logic.
export { resolveVerdict } from './verdict';
export const resolveAggregateVerdict: ResolveAggregateVerdict = (_input) => { throw new NotImplementedStageError('L6 aggregate verdict resolver'); };
