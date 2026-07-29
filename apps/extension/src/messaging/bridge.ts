import {
  isControlMessage,
  isSessionPortMessage,
  isTabMessage,
  type ControlMessage,
  type SessionPortMessage,
  type TabMessage,
} from './protocol';

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
    if (!isControlMessage(msg)) return false;
    const result = handler(msg, sender);
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
    if (!isTabMessage(msg)) return false;
    const result = handler(msg, sender);
    if (result instanceof Promise) {
      result.then(sendResponse, (error) => sendResponse({ __voxflowError: serializeError(error) }));
      return true;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

export interface SessionPort {
  readonly raw: chrome.runtime.Port;
  post(msg: SessionPortMessage): void;
  on(handler: (msg: SessionPortMessage) => void): () => void;
  onDisconnect(handler: (error?: chrome.runtime.LastError) => void): void;
}

export function connectSessionPort(name: string): SessionPort {
  return wrapPort(chrome.runtime.connect({ name }));
}

export function onSessionPortConnect(
  expectedName: string,
  handler: (port: SessionPort) => void,
): () => void {
  const listener = (port: chrome.runtime.Port) => {
    if (port.name === expectedName) handler(wrapPort(port));
  };
  chrome.runtime.onConnect.addListener(listener);
  return () => chrome.runtime.onConnect.removeListener(listener);
}

function wrapPort(port: chrome.runtime.Port): SessionPort {
  return {
    raw: port,
    post(msg) {
      port.postMessage(msg);
    },
    on(handler) {
      const listener = (msg: unknown) => {
        if (isSessionPortMessage(msg)) handler(msg);
      };
      port.onMessage.addListener(listener);
      return () => port.onMessage.removeListener(listener);
    },
    onDisconnect(handler) {
      port.onDisconnect.addListener(() => handler(chrome.runtime.lastError));
    },
  };
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
