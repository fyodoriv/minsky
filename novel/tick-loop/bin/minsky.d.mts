export declare function maybeBootstrapLocalLlm(_opts?: {
  readonly detectFn?: () => Promise<{
    readonly server: { readonly reachable: boolean; readonly url: string };
  }>;
}): Promise<Record<string, string>>;
