import type { LocalEngineClientMessage, LocalEngineServerMessage } from './local-engine-protocol';

export class LocalEngineClient {
  private socket: WebSocket | null = null;
  private handlers = new Set<(message: LocalEngineServerMessage) => void>();
  private errorHandlers = new Set<(error: Event) => void>();

  constructor(readonly url: string, readonly token = '') {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const url = withToken(this.url, this.token);
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', (event) => this.handleMessage(event));
    this.socket.addEventListener('error', (event) => {
      for (const handler of this.errorHandlers) handler(event);
    });
    await new Promise<void>((resolve, reject) => {
      const socket = this.socket;
      if (!socket) return reject(new Error('WebSocket was not created'));
      const cleanup = () => {
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`Unable to connect local engine: ${this.url}`));
      };
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
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

  onError(handler: (error: Event) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as LocalEngineServerMessage;
    for (const handler of this.handlers) handler(message);
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
