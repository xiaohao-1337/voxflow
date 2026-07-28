import type { ControlMessage, PcmPortMessage, TabMessage } from './protocol';

export async function sendControl(msg: ControlMessage): Promise<unknown> {
  return unwrapResponse(await chrome.runtime.sendMessage(msg));
}

export function onControlMessage(
  handler: (msg: ControlMessage, sender: chrome.runtime.MessageSender) => void | Promise<unknown>,
): () => void {
  const listener = (
    msg: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (!isProtocolMessage(msg)) return false;
    const result = handler(msg as ControlMessage, sender);
    if (result instanceof Promise) {
      result.then(sendResponse, (error) => sendResponse({ __voxflowError: serializeError(error) }));
      return true;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

export async function sendToTab(tabId: number, msg: TabMessage): Promise<unknown> {
  return unwrapResponse(await chrome.tabs.sendMessage(tabId, msg));
}

export function onTabMessage(
  handler: (msg: TabMessage, sender: chrome.runtime.MessageSender) => void | Promise<unknown>,
): () => void {
  const listener = (
    msg: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (!isProtocolMessage(msg)) return false;
    const result = handler(msg as TabMessage, sender);
    if (result instanceof Promise) {
      result.then(sendResponse, (error) => sendResponse({ __voxflowError: serializeError(error) }));
      return true;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

export interface PcmPort {
  readonly raw: chrome.runtime.Port;
  post(msg: PcmPortMessage): void;
  on(handler: (msg: PcmPortMessage) => void): () => void;
  onDisconnect(handler: (error?: chrome.runtime.LastError) => void): void;
}

export function connectPcmPort(name: string): PcmPort {
  return wrapPort(chrome.runtime.connect({ name }));
}

export function onPcmPortConnect(expectedName: string, handler: (port: PcmPort) => void): () => void {
  const listener = (port: chrome.runtime.Port) => {
    if (port.name === expectedName) handler(wrapPort(port));
  };
  chrome.runtime.onConnect.addListener(listener);
  return () => chrome.runtime.onConnect.removeListener(listener);
}

function wrapPort(port: chrome.runtime.Port): PcmPort {
  return {
    raw: port,
    post(msg) {
      port.postMessage(msg);
    },
    on(handler) {
      const listener = (msg: unknown) => {
        if (isProtocolMessage(msg)) handler(msg as PcmPortMessage);
      };
      port.onMessage.addListener(listener);
      return () => port.onMessage.removeListener(listener);
    },
    onDisconnect(handler) {
      port.onDisconnect.addListener(() => handler(chrome.runtime.lastError));
    },
  };
}

function isProtocolMessage(msg: unknown): msg is { kind: string } {
  return Boolean(msg && typeof msg === 'object' && 'kind' in msg);
}

function serializeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function unwrapResponse(response: unknown): unknown {
  if (
    response &&
    typeof response === 'object' &&
    '__voxflowError' in response &&
    typeof (response as { __voxflowError?: unknown }).__voxflowError === 'string'
  ) {
    throw new Error((response as { __voxflowError: string }).__voxflowError);
  }
  return response;
}
