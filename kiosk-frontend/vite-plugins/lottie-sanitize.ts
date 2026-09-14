import fs from 'node:fs/promises';
import type { Plugin } from 'vite';

const COLLIDING_CLASS_NAMES = new Set(['outline']);
const PREFIX = 'lt-';

function isLottieJson(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.v === 'string' &&
    typeof d.fr === 'number' &&
    Array.isArray(d.layers)
  );
}

function sanitizeCl(node: unknown): number {
  let count = 0;
  if (Array.isArray(node)) {
    for (const x of node) count += sanitizeCl(x);
    return count;
  }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.cl === 'string') {
      const parts = o.cl.split(/\s+/);
      const after = parts.map((c) =>
        COLLIDING_CLASS_NAMES.has(c) ? PREFIX + c : c,
      );
      if (parts.some((p, i) => p !== after[i])) {
        o.cl = after.join(' ');
        count++;
      }
    }
    for (const k in o) count += sanitizeCl(o[k]);
  }
  return count;
}

export function lottieSanitize(): Plugin {
  return {
    name: 'lottie-sanitize',
    enforce: 'pre',
    async load(id) {
      if (!id.endsWith('.json')) return null;
      const filePath = id.split('?')[0];
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf8');
      } catch {
        return null;
      }
      let data: unknown;
      try {
        data = JSON.parse(content);
      } catch {
        return null;
      }
      if (!isLottieJson(data)) return null;
      sanitizeCl(data);
      return JSON.stringify(data);
    },
  };
}
