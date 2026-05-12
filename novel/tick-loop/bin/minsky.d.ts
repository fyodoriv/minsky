export declare function maybeBootstrapLocalLlm(opts?: {
  readonly detectFn?: () => Promise<unknown>;
  readonly claudeProbeFn?: () => Promise<{ verdict: string; reason: string }>;
  readonly serverProbeFn?: () => Promise<{ reachable: boolean; url?: string; reason?: string }>;
  /** Slice 63: DI seam for the bootstrap executor. Tests inject a stub; production uses runBootstrapLocalLlm. */
  readonly bootstrapFn?: () => Promise<Record<string, string>>;
}): Promise<Record<string, string>>;
