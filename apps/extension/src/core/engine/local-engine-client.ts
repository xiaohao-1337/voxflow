import type { LocalEngineClientMessage, LocalEngineServerMessage } from './local-engine-protocol';

export type LocalEngineClientError = Error | Event;

export class LocalEngineClient {
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private handlers = new Set<(message: LocalEngineServerMessage) => void>();
  private errorHandlers = new Set<(error: LocalEngineClientError) => void>();
  private closeHandlers = new Set<(event: CloseEvent) => void>();

  constructor(
    readonly url: string,
    readonly token = '',
    private readonly connectTimeoutMs = 5000,
  ) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connectInner().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connectInner(): Promise<void> {
    const url = withToken(this.url, this.token);
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      if (this.socket === socket) this.handleMessage(event);
    });
    socket.addEventListener('error', (event) => {
      if (this.socket === socket) this.emitError(event);
    });
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      for (const handler of this.closeHandlers) handler(event);
    });
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timer);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onClose);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`Unable to connect local engine: ${this.url}`));
      };
      const onClose = () => {
        cleanup();
        reject(new Error(`Local engine closed before connection completed: ${this.url}`));
      };
      const timer = window.setTimeout(() => {
        cleanup();
        if (this.socket === socket) this.socket = null;
        socket.close();
        reject(new Error(`Local engine connection timed out after ${this.connectTimeoutMs}ms: ${this.url}`));
      }, this.connectTimeoutMs);
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
    });
  }

  send(message: LocalEngineClientMessage): void {
    if (!this.connected || !this.socket) throw new Error('Local engine WebSocket is not connected');
    this.socket.send(JSON.stringify(message));
  }

  onMessage(handler: (message: LocalEngineServerMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onError(handler: (error: LocalEngineClientError) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  onClose(handler: (event: CloseEvent) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return;
    try {
      const message = JSON.parse(event.data) as unknown;
      if (!isServerMessage(message)) throw new Error('Local engine returned an invalid message envelope');
      for (const handler of this.handlers) handler(message);
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private emitError(error: LocalEngineClientError): void {
    for (const handler of this.errorHandlers) handler(error);
  }
}

export function encodeF32leBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function withToken(url: string, token: string): string {
  if (!token) return url;
  const parsed = new URL(url);
  parsed.searchParams.set('token', token);
  return parsed.toString();
}

function isServerMessage(value: unknown): value is LocalEngineServerMessage {
  return Boolean(value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string');
}
