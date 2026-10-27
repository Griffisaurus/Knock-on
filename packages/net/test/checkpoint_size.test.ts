// MI (M4): desync-repair checkpoints may be bigger than ordinary messages (Matter state), up to the WebSocket cap.
import { describe, expect, it } from 'vitest';
import { MAX_CHECKPOINT_MESSAGE_BYTES, MAX_MESSAGE_BYTES, decodeClient, encode } from '../src/index.ts';

describe('message size limits', () => {
  it('accepts a checkpoint over 4 MB, refuses any other message that big', () => {
    const blob = new Uint8Array(6 << 20);
    const cp = encode(['checkpoint', { runId: 'r', tick: 60, blob }]);
    expect(cp.byteLength).toBeGreaterThan(MAX_MESSAGE_BYTES);
    expect(decodeClient(cp)[0]).toBe('checkpoint');
    const chat = encode(['chat', { text: 'x'.repeat(6 << 20) }]);
    expect(() => decodeClient(chat)).toThrow(/too large/);
    expect(() => decodeClient(new Uint8Array(MAX_CHECKPOINT_MESSAGE_BYTES + 1))).toThrow(/too large/);
  });
});
