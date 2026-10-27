// J4 (M4): the contact callbacks, as a plain same-origin ES module (contacts.ts explains the path). Every Jolt
// pthread imports this file through `Module.configureWorkerScripts` (default export) before it starts, and the sim
// thread runs the same function (named export), so there is one copy of the code. It is a file, not a data:/blob:
// URL, because the Host Server's CSP (script-src 'self') blocks those. Self-contained: no imports.
// Record and control-block layouts: contacts.ts (REC, CTL).

/** Installs the listener's callbacks on one thread's Module. */
export function contactCallbacks(J, p) {
  const L = J.wrapPointer(p.listener, J.ContactListenerJS);
  const c = p.ctl >> 2;
  const vec = new J.Vec3(0, 0, 0);
  // seq: Jolt reports all of one body pair's manifolds (one per sub-shape pair) from a single call on one thread,
  // in an order that doesn't depend on threads; pairs interleave differently. Numbering a pair's consecutive
  // callbacks on this thread recovers that order (the single-threaded order the M1–M3 goldens were pinned with)
  let lastB1 = 0, lastB2 = 0, lastStep = -1, seq = 0;
  const on = (b1p, b2p, mp, sp, added) => {
    const I = J.HEAP32, F = J.HEAPF32, U = J.HEAPU8;
    Atomics.add(I, c + 7, 1);
    const step = I[c + 8];
    if (b1p === lastB1 && b2p === lastB2 && step === lastStep) seq++;
    else { lastB1 = b1p; lastB2 = b2p; lastStep = step; seq = 0; }
    const b1 = J.wrapPointer(b1p, J.Body), b2 = J.wrapPointer(b2p, J.Body);
    const i1 = b1.GetUserData(), i2 = b2.GetUserData();
    const nTab = I[c + 6], fl = I[c + 3];
    const f1 = i1 >= 0 && i1 < nTab ? U[fl + i1] : 0, f2 = i2 >= 0 && i2 < nTab ? U[fl + i2] : 0;
    // conveyor: the belt drives whatever rests on it (Jolt's conveyor technique, SIMULATION §4.5). Jolt wants
    // (surface velocity of body 2) − (surface velocity of body 1); with two belts, body 2's wins (as in M1)
    if ((f1 | f2) & 1) {
      const settings = J.wrapPointer(sp, J.ContactSettings);
      const s = I[c + 4] >> 2;
      if (f1 & 1) { vec.Set(-F[s + i1 * 3], -F[s + i1 * 3 + 1], -F[s + i1 * 3 + 2]); settings.mRelativeLinearSurfaceVelocity = vec; }
      if (f2 & 1) { vec.Set(F[s + i2 * 3], F[s + i2 * 3 + 1], F[s + i2 * 3 + 2]); settings.mRelativeLinearSurfaceVelocity = vec; }
    }
    if (!added && !((f1 | f2) & 2)) return;
    const k = Atomics.add(I, c, 1);
    if (k >= I[c + 1]) return; // over capacity: counted, and the Machine reports it
    const o = (I[c + 2] >> 2) + k * 20;
    const m = J.wrapPointer(mp, J.ContactManifold);
    I[o] = i1; I[o + 1] = i2; I[o + 2] = added ? 1 : 0;
    I[o + 3] = m.mSubShapeID1.GetValue(); I[o + 4] = m.mSubShapeID2.GetValue();
    // the bindings return value types in one shared temporary per method: read each result before the next call
    const v1 = b1.GetLinearVelocity();
    F[o + 5] = v1.GetX(); F[o + 6] = v1.GetY(); F[o + 7] = v1.GetZ();
    const v2 = b2.GetLinearVelocity();
    F[o + 8] = v2.GetX(); F[o + 9] = v2.GetY(); F[o + 10] = v2.GetZ();
    const n = m.mWorldSpaceNormal;
    F[o + 11] = n.GetX(); F[o + 12] = n.GetY(); F[o + 13] = n.GetZ();
    F[o + 14] = b1.IsDynamic() ? b1.GetMotionProperties().GetInverseMass() : 0;
    F[o + 15] = b2.IsDynamic() ? b2.GetMotionProperties().GetInverseMass() : 0;
    const pt = m.GetWorldSpaceContactPointOn1(0);
    F[o + 16] = pt.GetX(); F[o + 17] = pt.GetY(); F[o + 18] = pt.GetZ();
    I[o + 19] = seq;
  };
  L.OnContactValidate = () => J.ValidateResult_AcceptAllContactsForThisBodyPair;
  L.OnContactAdded = (b1, b2, m, s) => on(b1, b2, m, s, true);
  // persisted contacts only matter to conveyors and pressure parts; without any, skip the work per contact (S3)
  L.OnContactPersisted = (b1, b2, m, s) => { if (J.HEAP32[c + 5]) on(b1, b2, m, s, false); };
  L.OnContactRemoved = () => {};
}

/**
 * The pthread entry (`configureWorkerScripts`): must return a promise. Counts the thread as started (control word 9,
 * read by the loader's start check), then installs the callbacks unless this is the check itself (listener 0).
 */
export default async function (J, p) {
  if (p.ctl) Atomics.add(J.HEAP32, (p.ctl >> 2) + 9, 1);
  if (p.listener) contactCallbacks(J, p);
}
