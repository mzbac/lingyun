/**
 * Web tools backed by a Chrome browser session over the Chrome DevTools
 * Protocol (CDP).
 *
 * A single visible Chrome instance with a persistent page tab is shared across
 * calls (per extension-session singleton). The browser is launched on demand,
 * kept alive between calls, and shut down on extension deactivate.
 *
 * Approval semantics: every browser-touching tool declares
 * `requiresApproval: true`, so the agent loop prompts before each call. Users
 * who want to approve once per session can use the chat UI's "Always allow"
 * for these tools, the global autoApprove setting, or "Approve this run".
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { WebSocket } from 'undici';

import type { ToolContext, ToolDefinition, ToolHandler, ToolResult } from '../../core/types';
import { optionalNumber, optionalString, requireString } from '@kooka/core';

/* ============================================================================
 * Constants
 * ==========================================================================*/

const DEFAULT_PORT = 9333;
const CONNECT_TIMEOUT_MS = 3000;
const CDP_TIMEOUT_MS = 20000;
const CHROME_READY_TIMEOUT_MS = 20000;
export const WEB_HEAD_BYTES = 8 * 1024;
export const WEB_HEAD_LINES = 100;
export const WEB_READ_MAX_LINES = 300;
export const PAGE_CACHE_MAX = 12;

/* ============================================================================
 * Small helpers
 * ==========================================================================*/

class WebError extends Error {}

function webError(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { success: false, error: message, metadata: { errorType: 'web_error' } };
}

export function countLines(text: string): number {
  if (!text) return 0;
  let lines = 0;
  for (const ch of text) {
    if (ch === '\n') lines++;
  }
  if (!text.endsWith('\n')) lines++;
  return lines;
}

/**
 * Head-biased slice: returns the first `maxLines` lines bounded by
 * `maxBytes` bytes (including the newline that completes the last line).
 */
export function headOf(
  text: string,
  maxLines: number,
  maxBytes: number,
): { head: string; lines: number; byteLimited: boolean } {
  let used = 0;
  let lines = 0;
  while (used < text.length && used < maxBytes && lines < maxLines) {
    if (text[used++] === '\n') lines++;
  }
  const byteLimited = used < text.length && used >= maxBytes;
  if (used > 0 && text[used - 1] !== '\n' && lines < maxLines) lines++;
  return { head: text.slice(0, used), lines, byteLimited };
}

/** Minimal JSON string extractor for CDP payloads. */
export function jsonGetString(json: string, key: string): string | null {
  const pattern = `"${key}"`;
  let idx = json.indexOf(pattern);
  while (idx >= 0) {
    let p = idx + pattern.length;
    while (p < json.length && ' \t\r\n'.includes(json[p])) p++;
    if (json[p] !== ':') {
      idx = json.indexOf(pattern, idx + 1);
      continue;
    }
    p++;
    while (p < json.length && ' \t\r\n'.includes(json[p])) p++;
    if (json[p] === '"') {
      p++;
      let out = '';
      while (p < json.length && json[p] !== '"') {
        if (json[p] === '\\') {
          const c = json[p + 1];
          switch (c) {
            case 'n': out += '\n'; break;
            case 'r': out += '\r'; break;
            case 't': out += '\t'; break;
            case 'b': out += '\b'; break;
            case 'f': out += '\f'; break;
            case '\\': out += '\\'; break;
            case '"': out += '"'; break;
            case '/': out += '/'; break;
            default: out += c; break;
          }
          p += 2;
        } else {
          out += json[p];
          p++;
        }
      }
      return out;
    }
    idx = json.indexOf(pattern, idx + 1);
  }
  return null;
}

export function urlEncode(input: string): string {
  return encodeURIComponent(input);
}

function storageRoot(context: ToolContext): string {
  try {
    const dir = context.extensionContext.globalStorageUri.fsPath;
    if (dir) return dir;
  } catch {
    /* fall through */
  }
  return path.join(os.homedir(), '.lingyun');
}

function sleep(ms: number, isCancelled: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      if (isCancelled()) {
        reject(new WebError('interrupted'));
        return;
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        resolve();
        return;
      }
      setTimeout(tick, Math.min(50, left));
    };
    tick();
  });
}

function throwIfCancelled(isCancelled: () => boolean): void {
  if (isCancelled()) throw new WebError('interrupted');
}

/* ============================================================================
 * Chrome executable discovery
 * ==========================================================================*/

export function discoverChromeExecutable(): string {
  const env = process.env.DS4_CHROME;
  if (env && env.trim()) return env.trim();

  if (process.platform === 'darwin') {
    for (const p of [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      if (fs.existsSync(p)) return p;
    }
  }

  for (const p of [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome',
  ]) {
    if (fs.existsSync(p)) return p;
  }

  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  const pathenv = process.env.PATH ?? '';
  for (const dir of pathenv.split(':')) {
    for (const name of names) {
      const candidate = path.join(dir || '.', name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return 'google-chrome';
}

function macChromeAppName(): string | null {
  if (process.env.DS4_CHROME) return null;
  if (process.platform !== 'darwin') return null;
  if (fs.existsSync('/Applications/Google Chrome.app')) return 'Google Chrome';
  if (fs.existsSync('/Applications/Chromium.app')) return 'Chromium';
  return null;
}

/* ============================================================================
 * CDP over WebSocket
 * ==========================================================================*/

interface CdpResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

class CdpSocket {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (msg: CdpResponse) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private opened: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener(
        'error',
        () => reject(new Error(`WebSocket error connecting to ${url}`)),
        { once: true },
      );
    });
    this.ws.addEventListener('message', (ev) => {
      this.handleMessage((ev as unknown as { data: unknown }).data);
    });
  }

  async open(timeoutMs: number): Promise<void> {
    await Promise.race([
      this.opened,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('WebSocket open timeout')), timeoutMs).unref?.();
      }),
    ]);
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let msg: CdpResponse;
    try {
      msg = JSON.parse(data) as CdpResponse;
    } catch {
      return;
    }
    if (typeof msg.id !== 'number') return; // events are ignored
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    entry.resolve(msg);
  }

  async call(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = CDP_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const result = new Promise<CdpResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout waiting for ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    const msg = await result;
    if (msg.error) {
      throw new WebError(`CDP ${method} failed: ${msg.error.message ?? JSON.stringify(msg.error)}`);
    }
    return msg.result ?? {};
  }

  async callOptional(method: string, params: Record<string, unknown>): Promise<void> {
    try {
      await this.call(method, params, 4000);
    } catch {
      /* best-effort emulation tweaks */
    }
  }

  /** Runtime.evaluate that must return a string value. */
  async evalString(expression: string): Promise<string> {
    const result = await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      includeCommandLineAPI: true,
    });
    if (result.exceptionDetails) {
      throw new WebError('JavaScript evaluation failed');
    }
    const value = (result.result as { value?: unknown } | undefined)?.value;
    if (typeof value !== 'string') {
      throw new WebError('Runtime.evaluate did not return a string value');
    }
    return value;
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

/* ============================================================================
 * Session singleton: visible Chrome + one persistent page tab
 * ==========================================================================*/

interface WebTab {
  targetId: string;
  wsUrl: string;
}

export interface PageCacheEntry {
  url: string;
  markdown: string;
  lines: number;
}

export interface WebSession {
  port: number;
  profileDir: string;
  chromePid: number | null;
  tab: WebTab | null;
  pageSeq: number;
  pages: Map<string, PageCacheEntry>;
}

let webSession: WebSession | null = null;

function getOrCreateSession(context: ToolContext): WebSession {
  if (!webSession) {
    webSession = {
      port: DEFAULT_PORT,
      profileDir: path.join(storageRoot(context), 'browser'),
      chromePid: null,
      tab: null,
      pageSeq: 0,
      pages: new Map(),
    };
  }
  return webSession;
}

async function cdpAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.includes('webSocketDebuggerUrl');
  } catch {
    return false;
  }
}

async function browserWsUrl(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
  });
  if (!res.ok) throw new WebError(`CDP HTTP status ${res.status}`);
  const body = await res.text();
  const wsUrl = jsonGetString(body, 'webSocketDebuggerUrl');
  if (!wsUrl) throw new WebError('Chrome did not return a browser WebSocket URL');
  return wsUrl;
}

async function spawnChrome(
  session: WebSession,
  log: (m: string) => void,
  isCancelled: () => boolean,
): Promise<void> {
  await fs.promises.mkdir(session.profileDir, { recursive: true });
  const exe = discoverChromeExecutable();
  const flags: string[] = [
    `--remote-debugging-port=${session.port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${session.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--password-store=basic',
    '--mute-audio',
  ];
  const isMac = process.platform === 'darwin';
  if (isMac) flags.push('--use-mock-keychain');
  if (!isMac && typeof process.getuid === 'function' && process.getuid() === 0) {
    flags.push('--no-sandbox');
  }
  flags.push('about:blank');

  let child: ChildProcess;
  const macApp = macChromeAppName();
  if (isMac && macApp) {
    // Launch via `open` so the app is treated as a normal visible window.
    child = spawn('/usr/bin/open', ['-g', '-na', macApp, '--args', ...flags], { stdio: 'ignore' });
  } else {
    child = spawn(exe, flags, { stdio: 'ignore' });
  }
  session.chromePid = child.pid ?? null;
  child.on('error', (error) => log(`Chrome launch error: ${error.message}`));
  child.unref?.();

  log('Starting visible Chrome browser session...');
  const deadline = Date.now() + CHROME_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    throwIfCancelled(isCancelled);
    if (await cdpAlive(session.port)) {
      log('Chrome browser session is ready');
      return;
    }
    await sleep(250, isCancelled);
  }
  throw new WebError(
    `Chrome did not expose CDP on port ${session.port} (executable: ${exe}). ` +
      `Set DS4_CHROME to point at a Chrome/Chromium binary if discovery failed.`,
  );
}

async function ensureBrowser(
  session: WebSession,
  log: (m: string) => void,
  isCancelled: () => boolean,
): Promise<void> {
  if (await cdpAlive(session.port)) return;
  await spawnChrome(session, log, isCancelled);
}

async function openTab(port: number, url: string): Promise<WebTab> {
  const browserUrl = await browserWsUrl(port);
  const socket = new CdpSocket(browserUrl);
  await socket.open(CONNECT_TIMEOUT_MS);
  try {
    const result = await socket.call('Target.createTarget', {
      url,
      background: true,
      newWindow: false,
    });
    const targetId = typeof result.targetId === 'string' ? result.targetId : '';
    if (!targetId) throw new WebError('Chrome did not return a page target id');
    return { targetId, wsUrl: `ws://127.0.0.1:${port}/devtools/page/${targetId}` };
  } finally {
    socket.close();
  }
}

async function closeTab(port: number, targetId: string): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(targetId)}`, {
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
  } catch {
    /* best-effort */
  }
}

async function ensureTab(
  session: WebSession,
  log: (m: string) => void,
  isCancelled: () => boolean,
): Promise<WebTab> {
  if (session.tab) return session.tab;
  throwIfCancelled(isCancelled);
  const tab = await openTab(session.port, 'about:blank');
  session.tab = tab;
  log(`Opened browser tab ${tab.targetId}`);
  return tab;
}

/** Drop the current tab (e.g. after it was closed by the user). */
async function resetTab(session: WebSession): Promise<void> {
  if (session.tab) {
    await closeTab(session.port, session.tab.targetId);
  }
  session.tab = null;
}

/* ============================================================================
 * Page pipeline JS
 * ==========================================================================*/

export const CLICK_CONSENT_JS = `(() => {
const clean=s=>(s||'').replace(/\\s+/g,' ').trim();
const pats=[/accept all/i,/i agree/i,/agree/i,/accetta tutto/i,/tout accepter/i,/aceptar todo/i,/alle akzeptieren/i];
const els=[...document.querySelectorAll('button,[role=button],input[type=submit],a')];
for (const el of els){const t=clean(el.innerText||el.value||el.textContent);
if(!t)continue; if(pats.some(p=>p.test(t))){el.click(); return 'clicked '+t;}}
return '';
})()`;

export const PAGE_PROBE_JS = `location.href+'\\n'+document.readyState+'\\n'+((document.body&&document.body.innerText)||'').length`;

export const SCROLL_DYNAMIC_PAGE_JS = `(() => new Promise(resolve => {
const root=()=>document.scrollingElement||document.documentElement||document.body;
const blockSel='h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,th,[id="content-text"],[class*="comment-body"],[class*="comment-content"],[data-testid*="comment-text"]';
const lazySel='[onscroll],[loading="lazy"],[data-src],[data-lazy],[class*="lazy"],[class*="infinite"],[class*="virtual"],[role="feed"],[id*="comment"],[class*="comment"],[data-testid*="comment"]';
const hookCount=()=>{let n=0;try{if(window.onscroll)n++;if(document.onscroll)n++;if(document.body&&document.body.onscroll)n++;}catch(e){}
try{if(typeof getEventListeners==='function'){for(const o of [window,document,document.body]){if(!o)continue;const ev=getEventListeners(o);if(ev&&ev.scroll)n+=ev.scroll.length;}}}catch(e){}
try{n+=document.querySelectorAll(lazySel).length;}catch(e){}return n;};
const metrics=()=>{const r=root();return {
height:r?r.scrollHeight:0,
view:innerHeight||900,
y:scrollY||(r&&r.scrollTop)||0,
text:((document.body&&document.body.innerText)||'').length,
links:document.links?document.links.length:0,
blocks:document.body?document.body.querySelectorAll(blockSel).length:0,
hooks:hookCount()};};
const sig=m=>[m.height,m.text,m.links,m.blocks].join('|');
const grew=(a,b)=>b.height>a.height+20||b.text>a.text+200||b.links>a.links+2||b.blocks>a.blocks+2;
const scrollOnce=()=>{const r=root();if(!r)return;
const h=Math.max(700,Math.floor((innerHeight||900)*0.85));
window.scrollTo(0,Math.min(r.scrollHeight,(scrollY||r.scrollTop||0)+h));};
let last=metrics(),lastSig=sig(last),same=0,steps=0;
const scrollable=last.height>last.view*1.35;
if(!scrollable||last.hooks===0){resolve('scroll skipped hooks='+last.hooks+' text='+last.text);return;}
const tick=()=>{
if(steps>=28){resolve('scrolled '+steps+' text='+last.text);return;}
const before=last;
scrollOnce();steps++;
setTimeout(()=>{const now=metrics(),nowSig=sig(now);
if(nowSig===lastSig)same++;else same=0;
const loaded=grew(before,now);
last=now;lastSig=nowSig;
if(steps===1&&!loaded){resolve('scroll probe unchanged text='+now.text);return;}
const atBottom=now.y+now.view+20>=now.height;
if(same>=4||(atBottom&&same>=1)){resolve('scrolled '+steps+' text='+now.text);return;}
tick();},900);
};tick();
}))()`;

export const SEARCH_EXTRACT_JS = `(() => {
const clean=s=>(s||'').replace(/\\s+/g,' ').trim();
const esc=s=>clean(s).replace(/\\\\/g,'\\\\\\\\').replace(/\\[/g,'\\\\[').replace(/\\]/g,'\\\\]').replace(/\\n/g,' ');
const visible=el=>{const r=el.getBoundingClientRect();const st=getComputedStyle(el);return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility!=='hidden'&&st.opacity!=='0';};
const bad=h=>(/(^|\\.)google\\./.test(h)||/(^|\\.)gstatic\\./.test(h)||/(^|\\.)googleusercontent\\./.test(h));
const lines=['# Google search results','',\`URL: \${location.href}\`,'','## Visible links'];
const seen=new Set();
for(const a of document.querySelectorAll('a[href]')){if(!visible(a))continue;let href=a.href||'';
try{const u=new URL(href);if(u.pathname==='/url'&&u.searchParams.get('q'))href=u.searchParams.get('q');}catch{}
let u;try{u=new URL(href);}catch{continue;}if(!/^https?:$/.test(u.protocol))continue;if(bad(u.hostname))continue;
const text=esc(a.innerText||a.textContent);if(text.length<3)continue;if(seen.has(u.href))continue;seen.add(u.href);
lines.push(\`- [\${text.slice(0,180)}](\${u.href})\`);if(seen.size>=20)break;}
lines.push('','## Text snapshot',clean(document.body.innerText).slice(0,1200));
return lines.join('\\n');
})()`;

export const EXTRACT_PAGE_JS = `(() => {
const clean=s=>(s||'').replace(/\\s+/g,' ').trim();
const esc=s=>clean(s).replace(/\\\\/g,'\\\\\\\\').replace(/\\[/g,'\\\\[').replace(/\\]/g,'\\\\]').replace(/\\n/g,' ');
const visible=el=>{const r=el.getBoundingClientRect();const st=getComputedStyle(el);return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility!=='hidden'&&st.opacity!=='0';};
const inline=n=>{if(!n)return'';if(n.nodeType===3)return n.nodeValue;if(n.nodeType!==1)return'';const el=n;
if(el.tagName==='SCRIPT'||el.tagName==='STYLE'||el.tagName==='NOSCRIPT')return'';
if(el.tagName==='A'){const t=esc(el.innerText||el.textContent);const h=el.href||'';return t&&h?\`[\${t}](\${h})\`:t;}
if(el.tagName==='CODE')return '\`'+clean(el.innerText||el.textContent).replace(/\`/g,'\\\`')+'\`';
return [...el.childNodes].map(inline).join('');};
const lines=[\`# \${clean(document.title)||location.href}\`,'',\`URL: \${location.href}\`,'','## Content'];
const blocks=[...document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,th,[id="content-text"],[class*="comment-body"],[class*="comment-content"],[data-testid*="comment-text"]')];
const seen=new Set();
for(const el of blocks){if(!visible(el))continue;let s='';const tag=el.tagName;
if(/^H[1-6]$/.test(tag)){s='#'.repeat(Number(tag[1]))+' '+inline(el);}
else if(tag==='LI'){s='- '+inline(el);}
else if(tag==='PRE'){s='\`\`\`\\n'+(el.innerText||el.textContent||'').trimEnd()+'\\n\`\`\`';}
else if(tag==='BLOCKQUOTE'){s='> '+clean(el.innerText||el.textContent);}
else{s=inline(el);}s=s.trim();if(!s||seen.has(s))continue;seen.add(s);lines.push('',s);
if(lines.join('\\n').length>900000){lines.push('','[Content truncated by browser extractor.]');break;}}
lines.push('','## Visible links');let n=0;const linkSeen=new Set();
for(const a of document.querySelectorAll('a[href]')){if(!visible(a))continue;const t=esc(a.innerText||a.textContent);if(t.length<3)continue;
let u;try{u=new URL(a.href);}catch{continue;}if(!/^https?:$/.test(u.protocol)||linkSeen.has(u.href))continue;linkSeen.add(u.href);
lines.push(\`- [\${t.slice(0,160)}](\${u.href})\`);if(++n>=80)break;}
return lines.join('\\n');
})()`;

export function clickSelectorJs(selector: string): string {
  return `(() => {
const el=document.querySelector(${JSON.stringify(selector)});
if(!el)return JSON.stringify({ok:false,error:'no element matches selector'});
el.scrollIntoView({block:'center',behavior:'instant'});
const r=el.getBoundingClientRect();
const x=r.left+r.width/2,y=r.top+r.height/2;
const opts={bubbles:true,cancelable:true,view:window,clientX:x,clientY:y};
el.dispatchEvent(new MouseEvent('mousedown',opts));
el.dispatchEvent(new MouseEvent('mouseup',opts));
el.dispatchEvent(new MouseEvent('click',opts));
if(typeof el.click==='function')el.click();
return JSON.stringify({ok:true,tag:el.tagName,text:(el.innerText||el.value||'').replace(/\\s+/g,' ').trim().slice(0,80)});
})()`;
}

export function typeSelectorJs(selector: string, text: string): string {
  const quoted = JSON.stringify(text);
  return `(() => {
const el=document.querySelector(${JSON.stringify(selector)});
if(!el)return JSON.stringify({ok:false,error:'no element matches selector'});
el.focus();
const proto=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:el.tagName==='INPUT'?window.HTMLInputElement.prototype:null;
if(proto){const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
if(setter)setter.call(el,${quoted});else el.value=${quoted};}
else if(el.isContentEditable){el.textContent=${quoted};}
else{el.value=${quoted};}
el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${quoted}}));
el.dispatchEvent(new Event('change',{bubbles:true}));
return JSON.stringify({ok:true,tag:el.tagName,value:(el.value||el.textContent||'').slice(0,80)});
})()`;
}

/* ============================================================================
 * Page pipeline
 * ==========================================================================*/

async function preparePage(ws: CdpSocket, isCancelled: () => boolean): Promise<void> {
  await ws.call('Page.enable', {});
  await ws.call('Runtime.enable', {});
  await ws.callOptional('Emulation.setFocusEmulationEnabled', { enabled: true });
  await ws.callOptional('Emulation.setDeviceMetricsOverride', {
    width: 1365,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // Wait for the tab to reach a usable ready state before navigating.
  for (let i = 0; i < 80; i++) {
    throwIfCancelled(isCancelled);
    let state = '';
    try {
      state = await ws.evalString('document.readyState');
    } catch {
      state = '';
    }
    if (state === 'complete' || state === 'interactive') {
      await sleep(800, isCancelled);
      return;
    }
    await sleep(250, isCancelled);
  }
}

/** Port of web_wait_navigated_ready: stable innerText length + real URL + readyState. */
async function waitNavigatedReady(ws: CdpSocket, isCancelled: () => boolean): Promise<void> {
  let lastLen = -1;
  let stable = 0;
  let sawRealUrl = false;

  for (let i = 0; i < 100; i++) {
    throwIfCancelled(isCancelled);
    let probe: string | null = null;
    try {
      probe = await ws.evalString(PAGE_PROBE_JS);
    } catch {
      probe = null;
    }
    if (!probe) {
      await sleep(250, isCancelled);
      continue;
    }
    const parts = probe.split('\n');
    if (parts.length < 3) {
      await sleep(250, isCancelled);
      continue;
    }
    const href = parts[0];
    const ready = parts[1];
    const textLen = parseInt(parts[2], 10) || 0;

    const realUrl = href.length > 0 && href !== 'about:blank' && !href.startsWith('chrome://');
    const readyState = ready === 'complete' || ready === 'interactive';
    if (realUrl) sawRealUrl = true;
    if (textLen > 0 && textLen === lastLen) stable++;
    else stable = 0;
    lastLen = textLen;

    if (sawRealUrl && readyState && textLen > 0 && stable >= 2) {
      await sleep(500, isCancelled);
      return;
    }
    if (sawRealUrl && readyState && i >= 24) return;
    await sleep(250, isCancelled);
  }
}

async function scrollDynamicPage(ws: CdpSocket, isCancelled: () => boolean): Promise<void> {
  throwIfCancelled(isCancelled);
  try {
    await ws.evalString(SCROLL_DYNAMIC_PAGE_JS);
  } catch (error) {
    if (error instanceof WebError && error.message === 'interrupted') throw error;
  }
  throwIfCancelled(isCancelled);
}

interface RunOnPageOptions {
  url?: string;
  js?: string;
  dynamicScroll?: boolean;
  log: (m: string) => void;
  isCancelled: () => boolean;
}

/**
 * Ensure browser + tab, optionally navigate, wait for readiness, click consent,
 * optionally scroll, then run `js` in the page. The tab stays open for later
 * page-action tools.
 */
async function runOnPage(
  session: WebSession,
  opts: RunOnPageOptions,
): Promise<string> {
  await ensureBrowser(session, opts.log, opts.isCancelled);

  let tab = await ensureTab(session, opts.log, opts.isCancelled);
  let ws = new CdpSocket(tab.wsUrl);
  try {
    await ws.open(CONNECT_TIMEOUT_MS);
  } catch {
    ws.close();
    // The tab may have been closed by the user; retry with a fresh one.
    await resetTab(session);
    tab = await ensureTab(session, opts.log, opts.isCancelled);
    ws = new CdpSocket(tab.wsUrl);
    await ws.open(CONNECT_TIMEOUT_MS);
  }
  void tab;

  try {
    await preparePage(ws, opts.isCancelled);

    if (opts.url) {
      await ws.call('Page.navigate', { url: opts.url });
      await waitNavigatedReady(ws, opts.isCancelled);
    }

    const clicked = await ws.evalString(CLICK_CONSENT_JS);
    if (clicked) {
      opts.log(clicked);
      await sleep(1500, opts.isCancelled);
      await waitNavigatedReady(ws, opts.isCancelled);
    }

    if (opts.dynamicScroll) {
      await scrollDynamicPage(ws, opts.isCancelled);
    }

    if (opts.js) {
      return await ws.evalString(opts.js);
    }
    return '';
  } finally {
    ws.close();
  }
}

/* ============================================================================
 * Page cache + output formatting
 * ==========================================================================*/

export function storePage(session: WebSession, url: string, markdown: string): string {
  const pageId = `p${++session.pageSeq}`;
  session.pages.set(pageId, { url, markdown, lines: countLines(markdown) });
  if (session.pages.size > PAGE_CACHE_MAX) {
    const oldest = session.pages.keys().next().value as string | undefined;
    if (oldest) session.pages.delete(oldest);
  }
  return pageId;
}

/**
 * Format a rendered page for the model: full markdown when small, otherwise a
 * head plus a page_id the model can page through with web_read (a head-plus-
 * follow-up-reads shape backed by an in-memory cache).
 */
export function formatPageOutput(
  toolName: string,
  url: string,
  markdown: string,
  session: WebSession,
): { data: string; outputText: string } {
  const totalLines = countLines(markdown);
  const { head, lines: headLines, byteLimited } = headOf(markdown, WEB_HEAD_LINES, WEB_HEAD_BYTES);
  const truncated = byteLimited || headLines < totalLines;

  if (!truncated) {
    const out = `<markdown>\n${markdown}\n</markdown>`;
    return { data: out, outputText: out };
  }

  const pageId = storePage(session, url, markdown);
  const out =
    `${toolName} url=${url}\n` +
    `page_id=${pageId} (${markdown.length} bytes, ${totalLines} lines)\n` +
    `<head -${WEB_HEAD_LINES} lines / ${WEB_HEAD_BYTES} bytes>\n` +
    `${head}\n` +
    `</head>\n` +
    `Use web_read page_id=${pageId} start_line=<line> max_lines=<count> to read more of the rendered page.`;
  return { data: out, outputText: out };
}

/* ============================================================================
 * Tools
 * ==========================================================================*/

const WEB_METADATA = {
  category: 'web',
  icon: 'globe',
  requiresApproval: true,
  readOnly: false,
  permission: 'web',
} as const;

export const googleSearchTool: ToolDefinition = {
  id: 'google_search',
  name: 'Google Search',
  description:
    'Search Google in a visible Chrome browser and return compact Markdown links to results. ' +
    'The first call starts a visible Chrome window (approved by the user). Use web_click to open a result link in the same tab.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  },
  execution: { type: 'function', handler: 'builtin.google_search' },
  metadata: {
    ...WEB_METADATA,
    permissionPatterns: [{ arg: 'query', kind: 'raw' }],
  },
};

export const visitPageTool: ToolDefinition = {
  id: 'visit_page',
  name: 'Visit Page',
  description:
    'Open a URL in a visible Chrome browser and return the rendered page as Markdown ' +
    '(title, content blocks, visible links). Large pages are truncated to a head; use ' +
    'web_read page_id=<id> to read the rest in chunks.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to open' },
    },
    required: ['url'],
  },
  execution: { type: 'function', handler: 'builtin.visit_page' },
  metadata: {
    ...WEB_METADATA,
    permissionPatterns: [{ arg: 'url', kind: 'raw' }],
  },
};

export const webReadTool: ToolDefinition = {
  id: 'web_read',
  name: 'Read Rendered Page',
  description:
    'Read more of a rendered page previously returned by visit_page or web_click, given its page_id. ' +
    'Returns cat-style numbered lines. Omit start_line to continue from the last read position.',
  parameters: {
    type: 'object',
    properties: {
      page_id: { type: 'string', description: 'Page id from a previous visit_page/web_click result' },
      start_line: { type: 'number', description: '0-based first line to return' },
      max_lines: { type: 'number', description: `Maximum lines to return (max ${WEB_READ_MAX_LINES})` },
    },
    required: ['page_id'],
  },
  execution: { type: 'function', handler: 'builtin.web_read' },
  metadata: {
    category: 'web',
    icon: 'globe',
    requiresApproval: false,
    readOnly: true,
    permission: 'read',
  },
};

export const webClickTool: ToolDefinition = {
  id: 'web_click',
  name: 'Click Element',
  description:
    'Click the first element matching a CSS selector in the current browser tab ' +
    '(e.g. a Google result link, button, or accordion). Waits for navigation if the click starts one, ' +
    'then returns the updated page as Markdown with a fresh page_id.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector of the element to click' },
    },
    required: ['selector'],
  },
  execution: { type: 'function', handler: 'builtin.web_click' },
  metadata: {
    ...WEB_METADATA,
    permissionPatterns: [{ arg: 'selector', kind: 'raw' }],
  },
};

export const webTypeTool: ToolDefinition = {
  id: 'web_type',
  name: 'Type Into Element',
  description:
    'Focus the first element matching a CSS selector in the current browser tab, set its value, ' +
    'and fire input/change events (works for <input>, <textarea>, and contenteditable). ' +
    'Returns a short confirmation; use web_click to submit if there is a button.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector of the input element' },
      text: { type: 'string', description: 'Text to type' },
    },
    required: ['selector', 'text'],
  },
  execution: { type: 'function', handler: 'builtin.web_type' },
  metadata: {
    ...WEB_METADATA,
    permissionPatterns: [{ arg: 'selector', kind: 'raw' }],
  },
};

export const webScreenshotTool: ToolDefinition = {
  id: 'web_screenshot',
  name: 'Screenshot Page',
  description:
    'Capture a PNG screenshot of the current browser tab and save it under the extension storage ' +
    'directory. Returns the absolute file path (and pixel dimensions) so the user can open it.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Optional file name (defaults to web_<timestamp>.png)' },
    },
    required: [],
  },
  execution: { type: 'function', handler: 'builtin.web_screenshot' },
  metadata: {
    ...WEB_METADATA,
  },
};

/* ============================================================================
 * Handlers
 * ==========================================================================*/

function toResult(title: string, data: string): ToolResult {
  return { success: true, data, metadata: { outputText: data, title } };
}

export const googleSearchHandler: ToolHandler = async (args, context) => {
  const query = requireString(args, 'query');
  if ('error' in query) return { success: false, error: query.error };
  try {
    const session = getOrCreateSession(context);
    const log = (m: string) => context.log(`web: ${m}`);
    const isCancelled = () => context.cancellationToken.isCancellationRequested;
    const url = `https://www.google.com/search?q=${urlEncode(query.value)}`;
    const markdown = await runOnPage(session, {
      url,
      js: SEARCH_EXTRACT_JS,
      log,
      isCancelled,
    });
    const out = formatPageOutput('google_search', url, markdown, session);
    return toResult('Google Search', out.outputText);
  } catch (error) {
    return webError(error);
  }
};

export const visitPageHandler: ToolHandler = async (args, context) => {
  const url = requireString(args, 'url');
  if ('error' in url) return { success: false, error: url.error };
  try {
    const session = getOrCreateSession(context);
    const log = (m: string) => context.log(`web: ${m}`);
    const isCancelled = () => context.cancellationToken.isCancellationRequested;
    const markdown = await runOnPage(session, {
      url: url.value,
      js: EXTRACT_PAGE_JS,
      dynamicScroll: true,
      log,
      isCancelled,
    });
    const out = formatPageOutput('visit_page', url.value, markdown, session);
    return toResult('Visit Page', out.outputText);
  } catch (error) {
    return webError(error);
  }
};

/**
 * Format a bounded read of a cached page for the model (cat-style numbered
 * lines, matching the `read` tool's output shape). Pure function used by
 * webReadHandler.
 */
export function formatPageReadOutput(
  entry: PageCacheEntry,
  pageId: string,
  start: number,
  maxLines: number,
): string {
  const lines = entry.markdown.split('\n');
  const slice = lines.slice(start, start + maxLines);
  const numbered = slice.map((line, index) => {
    const trimmed = line.length > 2000 ? line.substring(0, 2000) + '...' : line;
    return `${String(index + start + 1).padStart(5, '0')}| ${trimmed}`;
  });
  const lastReadLine = start + slice.length;
  const hasMore = entry.lines > lastReadLine;

  let output = `<page page_id=${pageId} url=${entry.url}>\n${numbered.join('\n')}`;
  if (hasMore) {
    output += `\n\n(Page has more lines. Use web_read page_id=${pageId} start_line=${lastReadLine} max_lines=${maxLines} to continue.)`;
  } else {
    output += `\n\n(End of page - total ${entry.lines} lines)`;
  }
  output += '\n</page>';
  return output;
}

export const webReadHandler: ToolHandler = async (args, _context) => {
  const pageId = requireString(args, 'page_id');
  if ('error' in pageId) return { success: false, error: pageId.error };
  const session = webSession;
  const entry = session?.pages.get(pageId.value);
  if (!entry) {
    return {
      success: false,
      error: `Unknown page_id "${pageId.value}". Call visit_page or web_click first to produce a page_id.`,
      metadata: { errorType: 'web_unknown_page' },
    };
  }

  const startRaw = optionalNumber(args, 'start_line');
  const start = Math.max(0, Math.floor(startRaw ?? 0));
  const maxRaw = Math.floor(optionalNumber(args, 'max_lines') ?? 100);
  const maxLines = Math.min(Math.max(1, maxRaw), WEB_READ_MAX_LINES);

  return toResult('Read Rendered Page', formatPageReadOutput(entry, pageId.value, start, maxLines));
};

export const webClickHandler: ToolHandler = async (args, context) => {
  const selector = requireString(args, 'selector');
  if ('error' in selector) return { success: false, error: selector.error };
  try {
    const session = getOrCreateSession(context);
    const log = (m: string) => context.log(`web: ${m}`);
    const isCancelled = () => context.cancellationToken.isCancellationRequested;

    if (!session.tab) {
      // No current tab yet: a click needs a page. Ask the model to visit_page first.
      return {
        success: false,
        error:
          'web_click requires a current browser tab. Call google_search or visit_page first to open a page.',
        metadata: { errorType: 'web_no_tab' },
      };
    }

    await ensureBrowser(session, log, isCancelled);

    const ws = new CdpSocket(session.tab.wsUrl);
    try {
      await ws.open(CONNECT_TIMEOUT_MS);
      await preparePage(ws, isCancelled);
      const raw = await ws.evalString(clickSelectorJs(selector.value));
      let res: { ok: boolean; tag?: string; text?: string; error?: string };
      try {
        res = JSON.parse(raw) as typeof res;
      } catch {
        res = { ok: false, error: `malformed click result: ${raw.slice(0, 200)}` };
      }
      if (!res.ok) {
        throw new WebError(`web_click: ${res.error ?? 'click failed'}`);
      }
      log(`clicked <${res.tag}> ${res.text ?? ''}`);
      await waitNavigatedReady(ws, isCancelled);
      const markdown = await ws.evalString(EXTRACT_PAGE_JS);
      const url = await ws.evalString('location.href');
      const out = formatPageOutput('web_click', url, markdown, session);
      return toResult('Click Element', out.outputText);
    } finally {
      ws.close();
    }
  } catch (error) {
    return webError(error);
  }
};

export const webTypeHandler: ToolHandler = async (args, context) => {
  const selector = requireString(args, 'selector');
  if ('error' in selector) return { success: false, error: selector.error };
  const text = requireString(args, 'text');
  if ('error' in text) return { success: false, error: text.error };
  try {
    const session = getOrCreateSession(context);
    const log = (m: string) => context.log(`web: ${m}`);
    const isCancelled = () => context.cancellationToken.isCancellationRequested;

    if (!session.tab) {
      return {
        success: false,
        error: 'web_type requires a current browser tab. Call google_search or visit_page first.',
        metadata: { errorType: 'web_no_tab' },
      };
    }

    await ensureBrowser(session, log, isCancelled);

    const ws = new CdpSocket(session.tab.wsUrl);
    try {
      await ws.open(CONNECT_TIMEOUT_MS);
      await preparePage(ws, isCancelled);
      const raw = await ws.evalString(typeSelectorJs(selector.value, text.value));
      let res: { ok: boolean; tag?: string; value?: string; error?: string };
      try {
        res = JSON.parse(raw) as typeof res;
      } catch {
        res = { ok: false, error: `malformed type result: ${raw.slice(0, 200)}` };
      }
      if (!res.ok) {
        throw new WebError(`web_type: ${res.error ?? 'type failed'}`);
      }
      const out = `Typed ${text.value.length} chars into <${res.tag}> (value now "${res.value ?? ''}").`;
      return toResult('Type Into Element', out);
    } finally {
      ws.close();
    }
  } catch (error) {
    return webError(error);
  }
};

export function pngDimensions(buffer: Buffer): { width: number; height: number } {
  // PNG signature + IHDR: width at offset 16, height at 20 (big-endian).
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  return { width: 0, height: 0 };
}

export const webScreenshotHandler: ToolHandler = async (args, context) => {
  try {
    const session = getOrCreateSession(context);
    const log = (m: string) => context.log(`web: ${m}`);
    const isCancelled = () => context.cancellationToken.isCancellationRequested;

    if (!session.tab) {
      return {
        success: false,
        error:
          'web_screenshot requires a current browser tab. Call google_search or visit_page first.',
        metadata: { errorType: 'web_no_tab' },
      };
    }

    await ensureBrowser(session, log, isCancelled);

    const ws = new CdpSocket(session.tab.wsUrl);
    try {
      await ws.open(CONNECT_TIMEOUT_MS);
      await preparePage(ws, isCancelled);
      const result = await ws.call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      const data = result.data;
      if (typeof data !== 'string' || !data) {
        throw new WebError('Page.captureScreenshot returned no data');
      }
      const buffer = Buffer.from(data, 'base64');

      const dir = path.join(storageRoot(context), 'screenshots');
      await fs.promises.mkdir(dir, { recursive: true });
      const nameRaw = optionalString(args, 'name');
      const name = nameRaw && /^[a-zA-Z0-9._-]+$/.test(nameRaw)
        ? (nameRaw.endsWith('.png') ? nameRaw : `${nameRaw}.png`)
        : `web_${Date.now()}.png`;
      const file = path.join(dir, name);
      await fs.promises.writeFile(file, buffer);

      const { width, height } = pngDimensions(buffer);
      const dims = width > 0 && height > 0 ? `, ${width}x${height}` : '';
      const out = `Screenshot saved to ${file} (${buffer.length} bytes${dims}).`;
      return {
        success: true,
        data: out,
        metadata: { outputText: out, title: 'Screenshot Page', imagePath: file },
      };
    } finally {
      ws.close();
    }
  } catch (error) {
    return webError(error);
  }
};

/* ============================================================================
 * Cleanup (called on extension deactivate)
 * ==========================================================================*/

/**
 * Shut down the shared Chrome instance gracefully. Idempotent; safe to call
 * even if the browser was never started.
 */
export async function disposeWebSession(): Promise<void> {
  const session = webSession;
  webSession = null;
  if (!session) return;

  if (session.tab) {
    await closeTab(session.port, session.tab.targetId);
    session.tab = null;
  }

  // Prefer a graceful CDP Browser.close; fall back to killing the pid.
  try {
    const url = await browserWsUrl(session.port);
    const ws = new CdpSocket(url);
    await ws.open(CONNECT_TIMEOUT_MS);
    await ws.call('Browser.close', {});
    ws.close();
    return;
  } catch {
    /* fall through to pid kill */
  }
  if (session.chromePid) {
    try {
      process.kill(session.chromePid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}
