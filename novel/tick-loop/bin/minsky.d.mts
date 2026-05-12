export declare function maybeBootstrapLocalLlm(opts?: {
  readonly detectFn?: () => Promise<unknown>;
  readonly claudeProbeFn?: () => Promise<{ verdict: string; reason: string }>;
  readonly bootstrapFn?: () => Promise<Record<string, string>>;
}): Promise<Record<string, string>>;
