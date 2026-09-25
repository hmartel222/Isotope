import { Type, type Static, type TSchema } from '@sinclair/typebox';

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const str = () => Type.String({ minLength: 1 });
const opt = Type.Optional;
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const choices = <const T extends string>(...values: T[]) => Type.Union(values.map(value => Type.Literal(value)));
const strings = () => Type.Array(str());
const natural = () => Type.Integer({ minimum: 0 });
const positive = () => Type.Integer({ minimum: 1 });

/** Already serialized JSON only. Runtime signature serialization is a later stage. */
export const JsonValueSchema = Type.Recursive(Self => Type.Union([
  Type.Null(), Type.Boolean(), Type.Number(), Type.String(), Type.Array(Self), Type.Record(Type.String(), Self),
]), { $id: 'JsonValue' });
export type JsonValue = Static<typeof JsonValueSchema>;
const json = Type.Ref(JsonValueSchema);
export const ConfidenceSchema = choices('high', 'medium', 'low');
export type Confidence = Static<typeof ConfidenceSchema>;
export const SinkKindSchema = choices('db_write', 'http_out', 'queue', 'email', 'returned_state', 'log_only');
export type SinkKind = Static<typeof SinkKindSchema>;
export const SeveritySchema = choices('critical', 'high', 'info');
export const VerdictSchema = choices('PASS', 'PASS_REASONED', 'FAIL', 'FAIL_REASONED', 'ESCALATE', 'INDETERMINATE', 'SKIP');
export type Verdict = Static<typeof VerdictSchema>;
export const VerdictProvenanceSchema = choices('mechanical', 'reasoned', 'unavailable');
export type VerdictProvenance = Static<typeof VerdictProvenanceSchema>;
export const CodeVersionSchema = Type.Union([Type.Literal('original'), Type.TemplateLiteral('patched:${string}', { minLength: 9 })]);
export type CodeVersion = Static<typeof CodeVersionSchema>;
export const FixtureRoleSchema = choices('planning', 'held_out');

export const ReplacementSchema = object({ path: str(), cardinality: choices('one', 'many'), semantics: opt(str()) });
export const CodemodSchema = Type.Union([
  object({ kind: Type.Literal('path_rename'), safe_when: str(), from: str(), to: str() }),
  object({ kind: Type.Literal('unsupported') }),
]);
export const ChangeSchema = object({
  object: str(), applies_to_events: opt(strings()), removed_path: opt(str()), removed_symbol: opt(str()), replacement: ReplacementSchema,
  ambiguity: opt(object({ when: str(), question: str(), options: strings() })),
  repair_policy: opt(object({ business_policy_required_when: str() })), codemod: opt(CodemodSchema),
});
export const ChangeSpecSchema = object({
  id: str(), provider: str(), title: str(), source: str(), verified_by: choices('human', 'draft'), verified_at: opt(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  versions: object({ from: str(), to: str() }), semantics: str(),
  detection: object({
    ecosystems: Type.Record(Type.String({ pattern: '^(npm|pypi)$' }), object({ packages: Type.Array(str(), { minItems: 1 }), breaking_from: str() }), { minProperties: 1, additionalProperties: false }),
    taint_roots: Type.Array(object({ kind: choices('call', 'type'), language: choices('ts', 'py'), pattern: str() }), { minItems: 1 }),
  }),
  changes: Type.Array(ChangeSchema, { minItems: 1 }),
  fixtures: object({ pair: str(), heldout_pair: opt(str()), ambiguity_pair: opt(str()), adaptation_pair: opt(str()), noop_pair: opt(str()) }),
});
export type ChangeSpec = Static<typeof ChangeSpecSchema>;

export const ChangeSpecSourceSchema = object({
  id: str(), declaredUri: opt(str()),
  mediaType: choices('text/plain', 'text/markdown', 'application/json', 'application/yaml'),
  content: str(), sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
});
export const ChangeSpecInputPacketSchema = object({
  schemaVersion: Type.Literal(1), providerHint: opt(str()),
  dependency: object({ ecosystem: choices('npm', 'pypi'), package: str(), fromVersion: str(), toVersion: str() }),
  supportedLanguages: Type.Array(choices('ts', 'py'), { minItems: 1, uniqueItems: true }),
  sources: Type.Array(ChangeSpecSourceSchema, { minItems: 1 }),
  inputHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
});
export type ChangeSpecInputPacket = Static<typeof ChangeSpecInputPacketSchema>;

export const TypedPathSegmentSchema = Type.Union([
  object({ kind: Type.Literal('property'), name: str() }),
  object({ kind: Type.Literal('wildcard') }),
]);
export const TypedPathSchema = object({ segments: Type.Array(TypedPathSegmentSchema, { minItems: 1 }) });
export type TypedPath = Static<typeof TypedPathSchema>;
export const TypedTaintRootSchema = Type.Union([
  object({ kind: Type.Literal('call'), language: choices('ts', 'py'), receiver: str(), members: Type.Array(str()), argumentMode: choices('none', 'wildcard') }),
  object({ kind: Type.Literal('type'), language: choices('ts', 'py'), qualifiedName: Type.Array(str(), { minItems: 1 }) }),
]);
export type TypedTaintRoot = Static<typeof TypedTaintRootSchema>;
export const AmbiguityPredicateSchema = Type.Union([
  object({ kind: choices('field_present', 'field_absent'), path: TypedPathSchema }),
  object({ kind: choices('array_length_equals', 'array_length_greater_than'), path: TypedPathSchema, value: natural() }),
  object({ kind: choices('values_all_equal', 'values_differ'), path: TypedPathSchema }),
]);
export const CandidateCitationSchema = object({ sourceId: str(), excerpt: str() });
export const CandidateChangeSchema = object({
  object: str(), appliesToEvents: opt(strings()), removedPath: opt(TypedPathSchema), removedSymbol: opt(str()),
  replacement: object({ path: TypedPathSchema, cardinality: choices('one', 'many'), semantics: opt(str()) }),
  ambiguity: opt(object({ predicate: AmbiguityPredicateSchema, question: str(), options: Type.Array(str(), { minItems: 2 }) })),
  repairPolicy: opt(object({ businessPolicyRequiredWhen: str() })),
  codemod: opt(Type.Union([
    object({ kind: Type.Literal('path_rename'), safeWhen: str(), from: TypedPathSchema, to: TypedPathSchema }),
    object({ kind: Type.Literal('unsupported') }),
  ])),
  citations: object({ removed: Type.Array(CandidateCitationSchema, { minItems: 1 }), replacement: Type.Array(CandidateCitationSchema, { minItems: 1 }), events: opt(Type.Array(CandidateCitationSchema, { minItems: 1 })) }),
});
export const ChangeSpecCandidateSchema = object({
  schemaVersion: Type.Literal(1), provider: str(), title: str(),
  describedVersions: object({ from: str(), to: str() }), semantics: str(),
  dependencyProposal: object({ ecosystem: choices('npm', 'pypi'), package: str(), breakingFrom: str() }),
  taintRoots: Type.Array(TypedTaintRootSchema, { minItems: 1 }),
  changes: Type.Array(CandidateChangeSchema, { minItems: 1 }),
  semanticsCitations: Type.Array(CandidateCitationSchema, { minItems: 1 }),
  unknowns: strings(), unsupportedFeatures: strings(), suspectedInjection: Type.Boolean(), abstain: Type.Boolean(),
});
export type ChangeSpecCandidate = Static<typeof ChangeSpecCandidateSchema>;

export const ChangeSpecCompilationReportSchema = object({
  schemaVersion: Type.Literal(1), inputHash: Type.String({ pattern: '^[a-f0-9]{64}$' }), candidateHash: opt(Type.String({ pattern: '^[a-f0-9]{64}$' })),
  compilerVersion: str(), promptVersion: positive(), modelId: str(), invocationCount: natural(), cacheStatus: choices('hit', 'miss', 'disabled'),
  structuralValidation: strings(), semanticValidation: strings(), projectBinding: strings(), resolverCompatibility: strings(),
  missingEvidence: strings(), unsupportedCapabilities: strings(), injectionWarnings: strings(),
  status: choices('generated', 'invalid', 'needs_review', 'evidence_missing', 'binding_failed', 'ready_for_approval'),
});
export type ChangeSpecCompilationReport = Static<typeof ChangeSpecCompilationReportSchema>;
export const SourceProvenanceSchema = object({
  inputHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  sources: Type.Array(object({ id: str(), declaredUri: opt(str()), mediaType: str(), sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }) }), { minItems: 1 }),
});
export const CompilerProvenanceSchema = object({ compilerVersion: str(), promptVersion: positive(), modelId: str(), invocationCount: natural(), rawResponseHash: Type.String({ pattern: '^[a-f0-9]{64}$' }), compilationReportHash: Type.String({ pattern: '^[a-f0-9]{64}$' }), cacheStatus: choices('hit', 'miss', 'disabled') });
export const DependencyBindingSchema = object({ ecosystem: choices('npm', 'pypi'), package: str(), fromVersion: str(), toVersion: str() });
export type DependencyBinding = Static<typeof DependencyBindingSchema>;
export const ProjectBindingSchema = object({
  status: choices('unbound', 'bound', 'ambiguous'), repositoryRootHash: opt(Type.String({ pattern: '^[a-f0-9]{64}$' })), language: opt(choices('ts', 'py')), module: opt(str()), matchedRoots: Type.Array(str()),
  matches: opt(Type.Array(object({ pattern: str(), file: str(), line: positive(), provenance: str() }))), diagnostics: opt(strings()),
});
export type ProjectBinding = Static<typeof ProjectBindingSchema>;
export const EvidenceBindingSchema = object({ status: choices('missing', 'bound'), pair: opt(str()), heldoutPair: opt(str()), oldVersion: opt(str()), newVersion: opt(str()), provenance: opt(str()), synthetic: opt(Type.Boolean()), fixtureHashes: Type.Record(Type.String({ minLength: 1 }), Type.String({ pattern: '^[a-f0-9]{64}$' })) });
export type EvidenceBinding = Static<typeof EvidenceBindingSchema>;
export const ApprovalSchema = object({
  actor: str(), approvedAt: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$' }),
  candidateHash: Type.String({ pattern: '^[a-f0-9]{64}$' }), sourceHash: Type.String({ pattern: '^[a-f0-9]{64}$' }), evidenceHash: Type.String({ pattern: '^[a-f0-9]{64}$' }), compilationReportHash: Type.String({ pattern: '^[a-f0-9]{64}$' }), policyVersion: str(),
});
export const ChangeSpecEnvelopeSchema = object({
  schemaVersion: Type.Literal(1), status: choices('draft', 'validated', 'approved', 'revoked'), candidate: ChangeSpecCandidateSchema,
  sourceProvenance: SourceProvenanceSchema, compilerProvenance: CompilerProvenanceSchema,
  dependencyBinding: DependencyBindingSchema, projectBinding: ProjectBindingSchema, evidenceBinding: EvidenceBindingSchema,
  approval: opt(ApprovalSchema), runtimeSpec: opt(ChangeSpecSchema), bundleHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
});
export type ChangeSpecEnvelope = Static<typeof ChangeSpecEnvelopeSchema>;
export const SelectedSpecsSchema = object({
  schemaVersion: Type.Literal(1),
  dependencyChanges: Type.Array(object({ ecosystem: choices('npm', 'pypi'), package: str(), from_version: str(), to_version: str() })),
  specs: Type.Array(object({ ...ChangeSpecSchema.properties, verified_by: Type.Literal('human'), verified_at: str() })),
});
export type SelectedSpecs = Static<typeof SelectedSpecsSchema>;

export const SourceLocationSchema = object({ file: str(), line: positive(), column: opt(positive()), endLine: opt(positive()) });
const adapter = choices('express_route', 'next_app_route', 'next_pages_api', 'lambda', 'plain');
export const EntryPointSchema = object({ id: str(), file: str(), export: str(), kind: adapter, language: choices('ts', 'py') });
export type EntryPoint = Static<typeof EntryPointSchema>;
export const ProvenanceSchema = object({
  confidence: ConfidenceSchema, provider: str(), specId: str(),
  basis: choices('provider_call', 'provider_type', 'one_hop_parameter', 'reexport', 'name_heuristic'), rootNodeId: opt(str()), evidenceRefs: opt(strings()),
});
export type Provenance = Static<typeof ProvenanceSchema>;
export const BDGNodeSchema = object({
  id: str(), kind: choices('taint_root', 'binding', 'transform', 'branch', 'local_call', 'sink'), entryPointId: str(),
  location: SourceLocationSchema, path: opt(str()), label: str(), provenance: ProvenanceSchema,
  aggregation: opt(Type.Boolean()), castSuppressed: opt(Type.Boolean()), optional: opt(Type.Boolean()), indeterminatePath: opt(Type.Boolean()),
});
export type BDGNode = Static<typeof BDGNodeSchema>;
export const BDGEdgeSchema = object({ from: str(), to: str(), kind: Type.Literal('flows_to'), pathSuffix: Type.String() });
export type BDGEdge = Static<typeof BDGEdgeSchema>;
export const SinkSchema = object({ nodeId: str(), kind: SinkKindSchema, name: str(), location: SourceLocationSchema });
export type Sink = Static<typeof SinkSchema>;
export const AffectedSiteSchema = object({ id: str(), entryPointId: str(), nodeId: str(), specId: str(), changeIndex: natural(), location: SourceLocationSchema, sinkNodeIds: strings(), provenance: ProvenanceSchema });
export type AffectedSite = Static<typeof AffectedSiteSchema>;
export const BDGSchema = object({ schemaVersion: Type.Literal(1), entryPoints: Type.Array(EntryPointSchema), nodes: Type.Array(BDGNodeSchema), edges: Type.Array(BDGEdgeSchema), sinks: Type.Array(SinkSchema), affectedSites: Type.Array(AffectedSiteSchema), skipped: Type.Array(object({ file: str(), reason: str() })) });
export type BDG = Static<typeof BDGSchema>;

export const RecordedCallSchema = object({ seq: natural(), mock: str(), sinkKind: SinkKindSchema, args: Type.Array(json) });
export type RecordedCall = Static<typeof RecordedCallSchema>;
export const SignatureSchema = object({ entryPointId: str(), codeVersion: CodeVersionSchema, payloadVersion: str(), fixturePair: str(), runIndex: natural(), returned: json, threw: nullable(object({ name: str(), message: Type.String(), stack: opt(Type.String()) })), calls: Type.Array(RecordedCallSchema), durationMs: Type.Number({ minimum: 0 }) });
export type Signature = Static<typeof SignatureSchema>;
export const DivergenceKindSchema = choices('identical', 'value_to_missing', 'call_dropped', 'threw_new_only', 'value_changed', 'type_changed', 'call_added', 'call_args_changed', 'field_added', 'unstable');
export const DivergenceSchema = object({ id: str(), pointer: Type.String({ pattern: '^(?:/(?:[^~/]|~[01])*)*$' }), sinkKind: nullable(SinkKindSchema), old: json, new: json, kind: DivergenceKindSchema, tier: choices('mechanical', 'semantic_question'), severity: nullable(SeveritySchema), bdgNodeId: nullable(str()), ambiguityCandidate: opt(Type.Boolean()) });
export type Divergence = Static<typeof DivergenceSchema>;
export const DiffReportSchema = object({ schemaVersion: Type.Literal(1), entryPointId: str(), fixturePair: str(), oldSignatureRef: str(), newSignatureRef: str(), stable: Type.Boolean(), unstablePointers: strings(), divergences: Type.Array(DivergenceSchema) });
export type DiffReport = Static<typeof DiffReportSchema>;
export const EvidenceRefSchema = Type.Union([
  object({ kind: Type.Literal('code'), file: str(), line: positive() }),
  object({ kind: Type.Literal('dataflow'), nodeId: str() }),
  object({ kind: Type.Literal('diff'), pointer: Type.String() }),
  object({ kind: Type.Literal('artifact'), path: str(), sha256: opt(str()) }),
]);
export type EvidenceRef = Static<typeof EvidenceRefSchema>;
const dataflow = object({ summary: str(), nodes: Type.Array(BDGNodeSchema), sinks: Type.Array(SinkSchema) });
const fragments = object({ old: json, new: json });
export const EvidencePacketSchema = object({
  packetVersion: Type.Literal(1),
  change: object({ specId: str(), title: str(), semantics: str(), removedPath: str(), replacement: ReplacementSchema, ambiguityHint: opt(object({ when: str(), satisfied: Type.Boolean(), question: str() })) }),
  code: object({ language: choices('ts', 'py'), entryPoint: object({ file: str(), export: str(), lines: Type.Tuple([positive(), positive()]) }), slice: str(), downstreamFunctions: Type.Array(object({ file: str(), name: str(), slice: str() }), { maxItems: 3 }) }),
  dataflow, execution: object({ old: SignatureSchema, new: SignatureSchema }), diff: Type.Array(DivergenceSchema), payloadFragments: fragments,
});
export type EvidencePacket = Static<typeof EvidencePacketSchema>;
export const ReasoningResultSchema = object({ classification: choices('incompatibility', 'benign_adaptation', 'human_decision_required'), confidence: ConfidenceSchema, causalExplanation: str(), affectedBehavior: str(), evidenceRefs: Type.Array(EvidenceRefSchema), humanQuestion: nullable(str()), recommendedAction: choices('none', 'apply_codemod', 'manual_review', 'ask_human'), suspectedInjection: Type.Boolean(), abstain: Type.Boolean() });
export type ReasoningResult = Static<typeof ReasoningResultSchema>;
export const VerdictResultSchema = object({ entryPointId: str(), verdict: VerdictSchema, provenance: VerdictProvenanceSchema, reason: str(), divergenceIds: strings(), reasoningRefs: strings(), evidenceRefs: Type.Array(EvidenceRefSchema), suspectedInjection: Type.Boolean() });
export type VerdictResult = Static<typeof VerdictResultSchema>;
export const VerdictReportSchema = object({ schemaVersion: Type.Literal(1), verdict: VerdictSchema, results: Type.Array(VerdictResultSchema) });
export type VerdictReport = Static<typeof VerdictReportSchema>;

export const RepairPacketSchema = object({
  repairPacketVersion: Type.Literal(1),
  change: object({ specId: str(), provider: str(), semantics: str(), removedPath: str(), replacement: ReplacementSchema, knownSafeCodemod: nullable(CodemodSchema) }),
  verdict: object({ type: choices('FAIL', 'FAIL_REASONED'), causalExplanation: str(), affectedBehavior: str() }),
  code: object({ primarySlice: str(), downstreamFunctions: Type.Array(object({ path: str(), name: str(), slice: str() }), { maxItems: 3 }) }),
  dataflow, execution: object({ baselineSignature: object({ ...SignatureSchema.properties, codeVersion: Type.Literal('original') }), newSignature: object({ ...SignatureSchema.properties, codeVersion: Type.Literal('original') }) }),
  diff: Type.Array(DivergenceSchema), providerPayloadFragments: fragments,
  constraints: object({ allowedPaths: Type.Array(str(), { minItems: 1, maxItems: 3, uniqueItems: true }), maxFiles: Type.Integer({ minimum: 1, maximum: 3 }), maxChangedLines: Type.Integer({ minimum: 1, maximum: 80 }) }),
});
export type RepairPacket = Static<typeof RepairPacketSchema>;
export const CandidatePatchEditSchema = object({ anchor: str(), replacement: Type.String() });
export type CandidatePatchEdit = Static<typeof CandidatePatchEditSchema>;
const patchFields = {
  repairId: str(), confidence: ConfidenceSchema, summary: str(), causalChain: str(), assumptions: strings(), evidenceRefs: Type.Array(EvidenceRefSchema), humanQuestion: nullable(str()), suspectedInjection: Type.Boolean(), abstain: Type.Boolean(), origin: choices('deterministic', 'model'),
};
/** Proposals have no authority. Only an independent verification can produce VerifiedRepair. */
const repairCandidateSchema = object({ ...patchFields, classification: Type.Literal('repair_candidate'), patch: object({ files: Type.Array(object({ path: str(), edits: Type.Array(CandidatePatchEditSchema, { minItems: 1 }) }), { minItems: 1, maxItems: 3 }) }) });
export const CandidatePatchSchema = Type.Union([
  repairCandidateSchema,
  object({ ...patchFields, classification: choices('human_decision_required', 'no_safe_repair'), patch: Type.Null() }),
]);
export type CandidatePatch = Static<typeof CandidatePatchSchema>;
export const RepairOutcomeSchema = choices('verified', 'overfit_rejected', 'did_not_restore_behavior', 'ambiguity_after_patch', 'patch_introduced_nondeterminism', 'patch_invalid', 'degenerate_patch');
export type RepairOutcome = Static<typeof RepairOutcomeSchema>;
const signatureRef = object({ path: str(), codeVersion: CodeVersionSchema, payloadVersion: str(), fixturePair: str(), runIndex: natural() });
export const VerificationPairResultSchema = object({
  role: FixtureRoleSchema, fixturePair: str(),
  baseline: object({ ...signatureRef.properties, codeVersion: Type.Literal('original') }),
  patchedOld: Type.Array(signatureRef, { minItems: 2 }), patchedNew: Type.Array(signatureRef, { minItems: 2 }),
  baselineDiffRef: str(), secondaryDiffRef: str(), verdict: VerdictResultSchema, stable: Type.Boolean(), baselineEquivalent: Type.Boolean(), secondaryStable: Type.Boolean(),
});
export type VerificationPairResult = Static<typeof VerificationPairResultSchema>;
const shapeChecks = object({ providerSinkFlowPreserved: Type.Boolean(), sinksPreserved: Type.Boolean(), noBaselineLiteralIntroduced: Type.Boolean(), taintRootReachable: Type.Boolean(), noNewSuppression: Type.Boolean() });
const verificationFields = {
  schemaVersion: Type.Literal(1), repairId: str(), entryPointId: str(), specId: str(), origin: choices('deterministic', 'model'), outcome: RepairOutcomeSchema, reason: str(),
  planning: nullable(VerificationPairResultSchema), heldOut: nullable(VerificationPairResultSchema), shapeChecks: nullable(shapeChecks), evidenceRefs: Type.Array(EvidenceRefSchema),
};
const passingPair = (role: 'planning' | 'held_out') => object({
  ...VerificationPairResultSchema.properties, role: Type.Literal(role), stable: Type.Literal(true), baselineEquivalent: Type.Literal(true), secondaryStable: Type.Literal(true),
  verdict: object({ ...VerdictResultSchema.properties, verdict: choices('PASS', 'PASS_REASONED') }),
});
const successfulVerification = object({
  ...verificationFields, outcome: Type.Literal('verified'), planning: passingPair('planning'), heldOut: passingPair('held_out'),
  shapeChecks: object({ providerSinkFlowPreserved: Type.Literal(true), sinksPreserved: Type.Literal(true), noBaselineLiteralIntroduced: Type.Literal(true), taintRootReachable: Type.Literal(true), noNewSuppression: Type.Literal(true) }),
});
export const RepairVerificationSchema = Type.Union([
  successfulVerification,
  object({ ...verificationFields, outcome: choices('overfit_rejected', 'did_not_restore_behavior', 'ambiguity_after_patch', 'patch_introduced_nondeterminism', 'patch_invalid', 'degenerate_patch') }),
]);
export type RepairVerification = Static<typeof RepairVerificationSchema>;
export const VerifiedRepairSchema = object({ schemaVersion: Type.Literal(1), repairId: str(), entryPointId: str(), specId: str(), candidate: object({ ...repairCandidateSchema.properties, confidence: choices('high', 'medium'), suspectedInjection: Type.Literal(false), abstain: Type.Literal(false) }), verification: successfulVerification, diff: str(), offeredOnly: Type.Literal(true) });
export type VerifiedRepair = Static<typeof VerifiedRepairSchema>;

export const IsotopeConfigSchema = object({
  version: Type.Literal(1), language: choices('ts', 'py', 'auto'),
  fixturePair: opt(str()),
  entryPoints: Type.Array(object({ file: str(), export: str(), kind: adapter }), { minItems: 1 }),
  mocks: Type.Array(Type.Union([
    object({
      module: str(), strategy: Type.Literal('provider'), adapter: opt(Type.Literal('fixture-call')),
      intercept: opt(Type.Array(str(), { minItems: 1, uniqueItems: true })), exports: opt(strings()),
      required: opt(Type.Boolean()),
      requestHeaders: opt(Type.Record(Type.String({ minLength: 1 }), str())),
      records: opt(Type.Record(Type.String({ minLength: 1 }), SinkKindSchema)),
      errorPatterns: opt(strings()),
    }),
    object({
      module: str(), strategy: Type.Literal('provider'), adapter: Type.Literal('real-method'),
      intercept: Type.Array(str(), { minItems: 1, uniqueItems: true }), exports: Type.Array(str(), { minItems: 1, uniqueItems: true }),
      required: opt(Type.Boolean()),
      response: object({
        kind: Type.Literal('canonical-json-bytes'), prefix: Type.String(), chunks: opt(positive()),
        fields: Type.Record(Type.String({ minLength: 1 }), Type.Array(str(), { minItems: 1 }), { minProperties: 1 }),
      }),
      requestHeaders: opt(Type.Record(Type.String({ minLength: 1 }), str())),
      records: opt(Type.Record(Type.String({ minLength: 1 }), SinkKindSchema)),
      errorPatterns: opt(strings()),
    }),
    object({ module: str(), adapter: opt(Type.Literal('method-record')), exports: Type.Record(str(), Type.Literal('recordAll'), { minProperties: 1 }), sinkKind: SinkKindSchema }),
  ])), returns: Type.Record(Type.String(), json), failOn: Type.Array(SeveritySchema, { uniqueItems: true }),
  reasoner: object({ mode: choices('on', 'off'), maxInvocations: Type.Integer({ minimum: 0, maximum: 10 }), redact: Type.Boolean() }),
  repair: object({ mode: choices('on', 'off'), planner: choices('model', 'deterministic-only'), maxAttempts: Type.Literal(1), maxFiles: Type.Integer({ minimum: 1, maximum: 3 }), maxChangedLines: Type.Integer({ minimum: 1, maximum: 80 }), selfConsistency: Type.Boolean(), verify: Type.Literal(true), redact: Type.Boolean() }),
  ignore: strings(),
});
export type IsotopeConfig = Static<typeof IsotopeConfigSchema>;
export const AuditRecordSchema = object({ stage: choices('reasoner', 'planner'), packetRef: str(), packetHash: str(), responseRef: str(), resultRef: opt(str()), invocationIndex: natural(), error: opt(str()) });
export const IsotopeReportSchema = object({ schemaVersion: Type.Literal(1), selectedSpecs: SelectedSpecsSchema, bdgRef: str(), signatureRefs: strings(), diffReportRefs: strings(), evidencePacketRefs: strings(), reasoningRefs: strings(), verdict: VerdictReportSchema, repairPacketRefs: strings(), candidateRefs: strings(), repairVerifications: Type.Array(RepairVerificationSchema), verifiedRepairs: Type.Array(VerifiedRepairSchema), audit: Type.Array(AuditRecordSchema) });
export type IsotopeReport = Static<typeof IsotopeReportSchema>;

/** Public JSON-Schema registry; TS types above are inferred from these same schemas. */
export const schemas = {
  ChangeSpec: ChangeSpecSchema, SelectedSpecs: SelectedSpecsSchema, EntryPoint: EntryPointSchema, Provenance: ProvenanceSchema,
  ChangeSpecInputPacket: ChangeSpecInputPacketSchema, ChangeSpecCandidate: ChangeSpecCandidateSchema,
  ChangeSpecCompilationReport: ChangeSpecCompilationReportSchema, ChangeSpecEnvelope: ChangeSpecEnvelopeSchema,
  DependencyBinding: DependencyBindingSchema, ProjectBinding: ProjectBindingSchema, EvidenceBinding: EvidenceBindingSchema, Approval: ApprovalSchema,
  BDG: BDGSchema, BDGNode: BDGNodeSchema, BDGEdge: BDGEdgeSchema, Sink: SinkSchema, AffectedSite: AffectedSiteSchema,
  Signature: SignatureSchema, RecordedCall: RecordedCallSchema, Divergence: DivergenceSchema, DiffReport: DiffReportSchema,
  EvidencePacket: EvidencePacketSchema, ReasoningResult: ReasoningResultSchema, Verdict: VerdictSchema, VerdictProvenance: VerdictProvenanceSchema, VerdictResult: VerdictResultSchema, VerdictReport: VerdictReportSchema,
  RepairPacket: RepairPacketSchema, CandidatePatch: CandidatePatchSchema, CandidatePatchEdit: CandidatePatchEditSchema, VerificationPairResult: VerificationPairResultSchema, RepairVerification: RepairVerificationSchema, VerifiedRepair: VerifiedRepairSchema,
  IsotopeConfig: IsotopeConfigSchema, IsotopeReport: IsotopeReportSchema,
} as const;
export type ContractName = keyof typeof schemas;
export type Contract<N extends ContractName> = Static<(typeof schemas)[N]>;
