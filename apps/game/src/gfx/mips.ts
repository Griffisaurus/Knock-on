// Mip chain for a 2D colour texture: each level is a 2×2 box filter of the one above, drawn as a
// fullscreen triangle. On an sRGB format the filter runs in linear space (the views decode and encode).

const MIP_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct VOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return VOut(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}
@fragment fn fs(v: VOut) -> @location(0) vec4f { return textureSampleLevel(src, smp, v.uv, 0.0); }
`;

const pipes = new WeakMap<GPUDevice, Map<GPUTextureFormat, GPURenderPipeline>>();

export function generateMips(d: GPUDevice, tex: GPUTexture): void {
  if (tex.mipLevelCount < 2) return;
  let byFormat = pipes.get(d);
  if (!byFormat) pipes.set(d, (byFormat = new Map()));
  let pipe = byFormat.get(tex.format);
  if (!pipe) {
    const mod = d.createShaderModule({ code: MIP_WGSL, label: 'mips' });
    pipe = d.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: tex.format }] },
      primitive: { topology: 'triangle-list' },
    });
    byFormat.set(tex.format, pipe);
  }
  const smp = d.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const enc = d.createCommandEncoder({ label: 'mips' });
  for (let l = 1; l < tex.mipLevelCount; l++) {
    const bind = d.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: tex.createView({ baseMipLevel: l - 1, mipLevelCount: 1 }) }, { binding: 1, resource: smp }],
    });
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: tex.createView({ baseMipLevel: l, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
    });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
  }
  d.queue.submit([enc.finish()]);
}
