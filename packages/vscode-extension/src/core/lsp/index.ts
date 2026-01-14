import type { LspAdapter } from './types';
import { VsCodeLspAdapter } from './vscodeAdapter';

let adapter: LspAdapter | undefined;

export function getLspAdapter(): LspAdapter {
  adapter ??= new VsCodeLspAdapter();
  return adapter;
}

