// Types for contact-script.js (J4): the contact callbacks every Jolt thread installs.
import type { JoltModule } from './load.ts';

export interface ContactScriptParams { readonly listener: number; readonly ctl: number }
export function contactCallbacks(J: JoltModule, p: ContactScriptParams): void;
declare function entry(J: JoltModule, p: ContactScriptParams): Promise<void>;
export default entry;
