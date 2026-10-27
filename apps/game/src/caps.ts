// Capability probe (ARCHITECTURE §9): shared by /check and the game boot.

/** VRAM tier ids (GAME_SPEC §15.2): 32 is the 32 GB class (RTX 5090), D85. */
export type Tier = 4 | 8 | 12 | 16 | 32;

export interface Capabilities {
  secureContext: boolean;
  webgpu: boolean;
  adapter: { vendor: string; architecture: string; description: string; fallback: boolean } | null;
  limits: { maxBufferSize: number; maxStorageBufferBindingSize: number; maxTextureArrayLayers: number } | null;
  features: string[];
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  wasmThreads: boolean;
  cores: number;
  deviceMemoryGB: number | null;
  tier: Tier;
}

export async function probe(): Promise<Capabilities> {
  const caps: Capabilities = {
    secureContext: window.isSecureContext,
    webgpu: 'gpu' in navigator,
    adapter: null,
    limits: null,
    features: [],
    crossOriginIsolated: window.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    wasmThreads: wasmThreadsSupported(),
    cores: navigator.hardwareConcurrency || 1,
    deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    tier: 4,
  };
  if (caps.webgpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        const info = adapter.info;
        caps.adapter = {
          vendor: info.vendor || 'unknown', architecture: info.architecture || '', description: info.description || '',
          fallback: (info as GPUAdapterInfo & { isFallbackAdapter?: boolean }).isFallbackAdapter ?? false,
        };
        caps.limits = {
          maxBufferSize: adapter.limits.maxBufferSize,
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
          maxTextureArrayLayers: adapter.limits.maxTextureArrayLayers,
        };
        caps.features = [...adapter.features].sort();
        caps.tier = estimateTier(caps);
      } else {
        caps.webgpu = false;
      }
    } catch {
      caps.webgpu = false;
    }
  }
  return caps;
}

/**
 * Rough tier from limits and vendor (RENDERING §11). Browsers don't report VRAM, so this is a
 * starting guess: the probe-allocation step in gpu-core refines it, and players can override.
 */
export function estimateTier(c: Capabilities): Tier {
  if (!c.limits || c.adapter?.fallback) return 4;
  // 32 GB class (D85): the adapter name is the only VRAM hint browsers give; players can also pick it in Settings
  if (/RTX\s*5090|RTX\s*4090\s*48|RTX\s*PRO\s*6000|RTX\s*A6000|RTX\s*6000\s*Ada|Radeon\s*PRO\s*W7900/i.test(`${c.adapter?.description ?? ''} ${c.adapter?.architecture ?? ''}`)) return 32;
  const bind = c.limits.maxStorageBufferBindingSize;
  const discrete = /nvidia|amd|ati/i.test(c.adapter?.vendor ?? '');
  const apple = /apple/i.test(c.adapter?.vendor ?? '');
  if (bind >= 2 ** 31 - 4 && (discrete || (apple && (c.deviceMemoryGB ?? 8) >= 8))) return 16;
  if (bind >= 2 ** 30) return discrete || apple ? 12 : 8;
  if (bind >= 2 ** 28) return 8;
  return 4;
}

function wasmThreadsSupported(): boolean {
  try {
    if (typeof SharedArrayBuffer === 'undefined') return false;
    const mem = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    return mem.buffer instanceof SharedArrayBuffer;
  } catch {
    return false;
  }
}
