export declare function maybeBootstrapLocalLlm(opts?: {
  readonly detectFn?: () => Promise<unknown>;
  readonly claudeProbeFn?: () => Promise<{ verdict: string; reason: string }>;
  readonly bootstrapFn?: () => Promise<Record<string, string>>;
}): Promise<Record<string, string>>;

// `actionId` is a `minsky-action-plan` `ActionId`; declared as `string`
// here so this ambient `.d.ts` does not pull `../dist/*.d.ts` into the
// tick-loop build graph (TS5055 — it would overwrite an emitted input).
export declare function envOverlayForAction(actionId: string): Record<string, string>;
