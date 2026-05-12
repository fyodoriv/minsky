export declare function maybeBootstrapLocalLlm(opts?: {
  readonly detectFn?: () => Promise<unknown>;
  readonly claudeProbeFn?: () => Promise<{ verdict: string; reason: string }>;
  readonly serverProbeFn?: () => Promise<{ reachable: boolean; url?: string; reason?: string }>;
}): Promise<Record<string, string>>;
