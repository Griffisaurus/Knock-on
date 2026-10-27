import { describe, expect, it } from 'vitest';
import { pack } from 'msgpackr';
import { ClockSync, ProtocolError, decodeClient, decodeServer, encode } from '../src/index.ts';

describe('protocol', () => {
  it('round-trips messages', () => {
    const m = ['chat', { text: 'boom incoming' }] as const;
    expect(decodeClient(encode(['chat', { text: 'boom incoming' }]))).toEqual(m);
    const s = decodeServer(encode(['op.ack', { clientOpId: '1:1', seq: 7 }]));
    expect(s).toEqual(['op.ack', { clientOpId: '1:1', seq: 7 }]);
  });
  it('rejects junk', () => {
    expect(() => decodeClient(pack(['nuke', {}]) as Uint8Array)).toThrow(ProtocolError);
    expect(() => decodeClient(pack(['chat', 'x']) as Uint8Array)).toThrow(ProtocolError);
    expect(() => decodeClient(new Uint8Array([0xc1]))).toThrow(ProtocolError);
    expect(() => decodeClient(new Uint8Array(10), 5)).toThrow(ProtocolError);
    expect(() => decodeClient(pack(['welcome', {}]) as Uint8Array)).toThrow(ProtocolError); // server-only type
  });
});

describe('ClockSync', () => {
  it('estimates offset and input delay', () => {
    const c = new ClockSync();
    for (let i = 0; i < 8; i++) {
      const t0 = 1000 + i * 100;
      const rtt = 40 + (i % 3) * 10;
      c.add(t0, t0 + rtt / 2 + 5000, t0 + rtt);
    }
    expect(c.ready).toBe(true);
    expect(c.offset).toBeCloseTo(5000, 0);
    expect(c.inputDelayTicks()).toBe(12);
    const slow = new ClockSync();
    for (let i = 0; i < 4; i++) slow.add(0, 150, 300);
    expect(slow.inputDelayTicks()).toBe(23);
  });
});
