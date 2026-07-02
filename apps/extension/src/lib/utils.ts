export function reportError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message || '(no message)'}`;
  if (error && typeof error === 'object') {
    const value = error as { name?: unknown; message?: unknown };
    const name = typeof value.name === 'string' ? value.name : 'Error';
    const message = typeof value.message === 'string' ? value.message : String(error);
    return `${name}: ${message}`;
  }
  return String(error);
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
