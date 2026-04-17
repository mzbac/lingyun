import * as assert from 'assert';

import {
  getWebviewMessageType,
  parseWebviewErrorMessage,
  parseWebviewInitAckMessage,
  parseWebviewReadyMessage,
  WEBVIEW_MESSAGE_ERROR,
  WEBVIEW_MESSAGE_INIT_ACK,
  WEBVIEW_MESSAGE_READY,
} from '../../ui/chat/webviewProtocol';
import { handleWebviewInitAckMessage, handleWebviewReadyMessage } from '../../ui/chat/webviewHandshake';

suite('Chat webview protocol', () => {
  test('protocol parsers normalize the touched handshake and crash message shapes', () => {
    assert.strictEqual(getWebviewMessageType({ type: WEBVIEW_MESSAGE_READY }), WEBVIEW_MESSAGE_READY);
    assert.strictEqual(getWebviewMessageType({ type: WEBVIEW_MESSAGE_INIT_ACK }), WEBVIEW_MESSAGE_INIT_ACK);
    assert.strictEqual(getWebviewMessageType({ type: WEBVIEW_MESSAGE_ERROR }), WEBVIEW_MESSAGE_ERROR);
    assert.strictEqual(getWebviewMessageType(null), undefined);

    assert.deepStrictEqual(parseWebviewReadyMessage({ type: WEBVIEW_MESSAGE_READY, clientInstanceId: '  client-1  ' }), {
      type: WEBVIEW_MESSAGE_READY,
      clientInstanceId: 'client-1',
    });
    assert.deepStrictEqual(parseWebviewReadyMessage({ type: WEBVIEW_MESSAGE_READY, clientInstanceId: '   ' }), {
      type: WEBVIEW_MESSAGE_READY,
    });
    assert.strictEqual(parseWebviewReadyMessage({ type: WEBVIEW_MESSAGE_INIT_ACK, clientInstanceId: 'client-1' }), undefined);

    assert.deepStrictEqual(parseWebviewInitAckMessage({ type: WEBVIEW_MESSAGE_INIT_ACK, clientInstanceId: '  client-2 ' }), {
      type: WEBVIEW_MESSAGE_INIT_ACK,
      clientInstanceId: 'client-2',
    });
    assert.deepStrictEqual(parseWebviewErrorMessage({ type: WEBVIEW_MESSAGE_ERROR, error: { source: 'window.error' } }), {
      type: WEBVIEW_MESSAGE_ERROR,
      error: { source: 'window.error' },
    });
    assert.deepStrictEqual(parseWebviewErrorMessage({ type: WEBVIEW_MESSAGE_ERROR }), {
      type: WEBVIEW_MESSAGE_ERROR,
    });
  });

  test('handshake helpers own ready and stale initAck invariants', () => {
    const clearedIntervals: NodeJS.Timeout[] = [];
    const state = {
      initAcked: true,
      initInterval: {} as NodeJS.Timeout,
      webviewClientInstanceId: 'stale-client',
      startInitPusherCalls: 0,
      startInitPusher() {
        this.startInitPusherCalls++;
      },
    };

    handleWebviewReadyMessage(state, { type: WEBVIEW_MESSAGE_READY, clientInstanceId: 'client-1' });
    assert.strictEqual(state.webviewClientInstanceId, 'client-1');
    assert.strictEqual(state.initAcked, false);
    assert.strictEqual(state.startInitPusherCalls, 1);

    const originalClearInterval = global.clearInterval;
    (global as any).clearInterval = (interval: NodeJS.Timeout) => {
      clearedIntervals.push(interval);
    };

    try {
      const accepted = handleWebviewInitAckMessage(state, {
        type: WEBVIEW_MESSAGE_INIT_ACK,
        clientInstanceId: 'client-1',
      });
      assert.strictEqual(accepted, true);
      assert.strictEqual(state.initAcked, true);
      assert.strictEqual(state.initInterval, undefined);
      assert.strictEqual(clearedIntervals.length, 1);

      state.initAcked = false;
      state.initInterval = {} as NodeJS.Timeout;
      const rejected = handleWebviewInitAckMessage(state, {
        type: WEBVIEW_MESSAGE_INIT_ACK,
        clientInstanceId: 'other-client',
      });
      assert.strictEqual(rejected, false);
      assert.strictEqual(state.initAcked, false);
      assert.notStrictEqual(state.initInterval, undefined);
      assert.strictEqual(state.webviewClientInstanceId, 'client-1');
      assert.strictEqual(clearedIntervals.length, 1);
    } finally {
      (global as any).clearInterval = originalClearInterval;
    }
  });
});
