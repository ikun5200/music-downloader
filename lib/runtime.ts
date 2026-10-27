let runtimePromise: Promise<void> | null = null

export function ensureRuntime(): Promise<void> {
  if (!runtimePromise) {
    runtimePromise = import('./bootstrap')
      .then(({ bootstrap }) => bootstrap())
      .catch((e) => {
        runtimePromise = null
        throw e
      })
  }
  return runtimePromise
}
