export type HarnessFailureReason =
  | 'unsupported_harness_plan' | 'adapter_not_implemented' | 'mock_resolution_failed'
  | 'provider_stub_not_exercised' | 'blocked_egress' | 'harness_timeout'
  | 'harness_could_not_run' | 'invalid_child_output' | 'unsupported_behavior_serialization'
  | 'serialization_limit' | 'artifact_write_failed';
export class HarnessExecutionError extends Error {
  constructor(readonly reason: HarnessFailureReason, message: string,
    readonly diagnostics: Record<string, unknown> = {}) {
    super(message); this.name = 'HarnessExecutionError';
  }
}
