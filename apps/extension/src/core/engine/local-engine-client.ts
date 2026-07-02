import type { LocalEngineClientMessage, LocalEngineServerMessage } from './local-engine-protocol';

export class LocalEngineClientPlaceholder {
  readonly connected = false;

  constructor(readonly url: string, readonly token: string) {}

  async connect(): Promise<void> {
    // Placeholder: the local AI engine is not implemented in this milestone.
  }

  send(_message: LocalEngineClientMessage): void {
    // Placeholder for WebSocket send.
  }

  onMessage(_handler: (message: LocalEngineServerMessage) => void): void {
    // Placeholder for WebSocket receive.
  }

  close(): void {
    // Placeholder for WebSocket close.
  }
}
