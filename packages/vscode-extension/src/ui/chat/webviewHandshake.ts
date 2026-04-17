import type { WebviewInitAckMessage, WebviewReadyMessage } from './webviewProtocol';

/**
 * Owns the init handshake invariants for a single live webview client.
 *
 * The extension may receive repeated `ready` messages before init completes, and late
 * `initAck` messages from a stale client after the webview has been recreated. Callers
 * should not need to re-implement those lifecycle rules.
 */
export type WebviewHandshakeState = {
  initAcked: boolean;
  initInterval?: NodeJS.Timeout;
  webviewClientInstanceId?: string;
  startInitPusher(): void;
};

export function handleWebviewReadyMessage(
  state: WebviewHandshakeState,
  message: WebviewReadyMessage | undefined
): void {
  if (message?.clientInstanceId) {
    state.webviewClientInstanceId = message.clientInstanceId;
  }

  state.initAcked = false;
  state.startInitPusher();
}

export function handleWebviewInitAckMessage(
  state: WebviewHandshakeState,
  message: WebviewInitAckMessage | undefined
): boolean {
  if (message?.clientInstanceId) {
    const incoming = message.clientInstanceId;
    if (state.webviewClientInstanceId && incoming !== state.webviewClientInstanceId) {
      return false;
    }
    state.webviewClientInstanceId = incoming;
  }

  state.initAcked = true;
  if (state.initInterval) {
    clearInterval(state.initInterval);
    state.initInterval = undefined;
  }
  return true;
}
