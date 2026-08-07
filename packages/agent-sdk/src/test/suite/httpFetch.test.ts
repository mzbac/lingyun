import * as assert from 'assert';
import http from 'node:http';

import {
  combineAbortSignals,
  createFetchWithStreamingDefaults,
  createTimeoutSignal,
  normalizeBaseURL,
} from '@kooka/core';

/**
 * Direct unit tests for the shared `@kooka/core` httpFetch machinery
 * (createFetchWithStreamingDefaults / createTimeoutSignal / combineAbortSignals
 * / normalizeBaseURL). The provider-level suite (openaiCompatible.test.ts)
 * exercises the same code through OpenAICompatibleProvider; these tests pin the
 * module's own API surface, including the streaming-gap behavior that only the
 * low-level Agent options (bodyTimeout/headersTimeout = 0) can guarantee.
 */
suite('httpFetch (shared @kooka/core machinery)', () => {
  function listen(server: http.Server): Promise<number> {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Expected server to bind to a TCP port'));
          return;
        }
        resolve(address.port);
      });
    });
  }

  function close(server: http.Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
  }

  test('allows slow streaming response gaps without timing out', async function () {
    this.timeout(5000);
    const GAP_MS = 800;
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: first\n\n');
      setTimeout(() => {
        if (res.writableEnded || res.destroyed) return;
        res.write('data: second\n\n');
        res.end();
      }, GAP_MS);
    });

    const port = await listen(server);
    const fetchWithDefaults = createFetchWithStreamingDefaults();
    try {
      const response = await fetchWithDefaults.fetch(`http://127.0.0.1:${port}/stream`);
      const text = await response.text();
      assert.ok(text.includes('first'), 'expected first SSE chunk');
      assert.ok(text.includes('second'), 'expected second SSE chunk after the gap');
    } finally {
      fetchWithDefaults.dispose();
      await close(server);
    }
  });

  test('preserves custom accept-encoding case-insensitively and skips empty headers', async () => {
    let observedHeaders: http.IncomingHttpHeaders | undefined;
    const server = http.createServer((req, res) => {
      observedHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });

    const port = await listen(server);
    const fetchWithDefaults = createFetchWithStreamingDefaults();
    try {
      const headers = Object.assign(Object.create({ 'x-inherited': 'skip' }), {
        'AcCePt-EnCoDiNg': 'br',
        'x-count': 42,
        'x-optional': undefined,
        'x-empty': null,
      });
      const response = await fetchWithDefaults.fetch(`http://127.0.0.1:${port}/headers`, {
        headers: headers as any,
      });
      await response.text();

      assert.strictEqual(observedHeaders?.['accept-encoding'], 'br');
      assert.strictEqual(observedHeaders?.['x-count'], '42');
      assert.strictEqual(observedHeaders?.['x-optional'], undefined);
      assert.strictEqual(observedHeaders?.['x-empty'], undefined);
      assert.strictEqual(observedHeaders?.['x-inherited'], undefined);
    } finally {
      fetchWithDefaults.dispose();
      await close(server);
    }
  });

  test('preserves Request headers and lets init headers override them', async () => {
    let observedHeaders: http.IncomingHttpHeaders | undefined;
    const server = http.createServer((req, res) => {
      observedHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });

    const port = await listen(server);
    const fetchWithDefaults = createFetchWithStreamingDefaults();
    try {
      const request = new Request(`http://127.0.0.1:${port}/request-headers`, {
        headers: {
          Authorization: 'Bearer request-token',
          'Accept-Encoding': 'gzip',
          'X-Request-Only': 'present',
          'X-Override': 'request-value',
        },
      });

      const response = await fetchWithDefaults.fetch(request, {
        headers: {
          'x-override': 'init-value',
          'x-init-only': 'present',
        },
      });
      await response.text();

      assert.strictEqual(observedHeaders?.authorization, 'Bearer request-token');
      assert.strictEqual(observedHeaders?.['accept-encoding'], 'gzip');
      assert.strictEqual(observedHeaders?.['x-request-only'], 'present');
      assert.strictEqual(observedHeaders?.['x-init-only'], 'present');
      assert.strictEqual(observedHeaders?.['x-override'], 'init-value');
    } finally {
      fetchWithDefaults.dispose();
      await close(server);
    }
  });

  test('normalizes base URLs by trimming trailing slashes', () => {
    assert.strictEqual(normalizeBaseURL('http://localhost:8080/v1/'), 'http://localhost:8080/v1');
    assert.strictEqual(normalizeBaseURL('http://localhost:8080/v1////'), 'http://localhost:8080/v1');
    assert.strictEqual(normalizeBaseURL('http://localhost:8080'), 'http://localhost:8080');
  });

  test('unrefs fallback timeout timers when AbortSignal.timeout is unavailable', () => {
    const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
    const originalSetTimeout = globalThis.setTimeout;
    let unrefCalled = false;

    Object.defineProperty(AbortSignal, 'timeout', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    globalThis.setTimeout = ((_callback: (...args: unknown[]) => void, _delay?: number) => ({
      unref: () => {
        unrefCalled = true;
      },
    })) as unknown as typeof setTimeout;

    try {
      const signal = createTimeoutSignal(60_000);
      assert.strictEqual(signal.aborted, false);
      assert.strictEqual(unrefCalled, true);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      if (timeoutDescriptor) {
        Object.defineProperty(AbortSignal, 'timeout', timeoutDescriptor);
      } else {
        delete (AbortSignal as any).timeout;
      }
    }
  });

  test('uses fallback timeout when AbortSignal.timeout is unavailable', async () => {
    const server = http.createServer((_req, _res) => {
      // Intentionally leave the request open so only the shared fetch timeout can complete it.
    });

    const port = await listen(server);
    const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
    Object.defineProperty(AbortSignal, 'timeout', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const fetchWithDefaults = createFetchWithStreamingDefaults(40);
    try {
      let thrown: unknown;
      try {
        await fetchWithDefaults.fetch(`http://127.0.0.1:${port}/hang`);
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, 'expected fetch to time out');
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      assert.match(message, /timed out/i);
    } finally {
      fetchWithDefaults.dispose();
      if (timeoutDescriptor) {
        Object.defineProperty(AbortSignal, 'timeout', timeoutDescriptor);
      } else {
        delete (AbortSignal as any).timeout;
      }
      await close(server);
    }
  });

  test('preserves user abort reason when AbortSignal.any is unavailable', async () => {
    const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
    Object.defineProperty(AbortSignal, 'any', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      const controller = new AbortController();
      const abortCause = new Error('user cancelled provider request');
      abortCause.name = 'AbortError';
      controller.abort(abortCause);

      const combined = combineAbortSignals([controller.signal]);
      assert.strictEqual(combined.aborted, true);
      assert.strictEqual(combined.reason, abortCause);

      const fetchWithDefaults = createFetchWithStreamingDefaults(60_000);
      try {
        let thrown: unknown;
        try {
          await fetchWithDefaults.fetch('http://127.0.0.1:9/aborted', { signal: combined });
        } catch (error) {
          thrown = error;
        }
        assert.ok(thrown, 'expected fetch to reject on aborted signal');
      } finally {
        fetchWithDefaults.dispose();
      }
    } finally {
      if (anyDescriptor) {
        Object.defineProperty(AbortSignal, 'any', anyDescriptor);
      } else {
        delete (AbortSignal as any).any;
      }
    }
  });
});
