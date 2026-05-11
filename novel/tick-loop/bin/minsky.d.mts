export declare function maybeBootstrapLocalLlm(opts?: {
  readonly detectFn?: () => Promise<unknown>;
  readonly claudeProbeFn?: () => Promise<{ verdict: string; reason: string }>;
}): Promise<Record<string, string>>;
