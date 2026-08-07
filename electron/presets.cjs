/** Device performance presets aligned with the Electron feasibility report. */

const PRESETS = {
  high: {
    id: 'high',
    label: '高端旗舰',
    cpu: 1,
    heap: 0,
    softGpu: false,
    oomWarnMb: 900,
    net: { latency: 20, down: 10e6, up: 5e6 },
    metrics: { width: 393, height: 852, dpr: 3 },
    description: '不节流 · 硬件 GPU · 快网。接近旗舰机日常表现。',
  },
  mid: {
    id: 'mid',
    label: '中端主流',
    cpu: 4,
    heap: 512,
    softGpu: false,
    oomWarnMb: 550,
    net: { latency: 80, down: 4e6, up: 1.5e6 },
    metrics: { width: 390, height: 844, dpr: 3 },
    description: 'CPU 4× · JS 堆 512MB · 4G 网。对标骁龙 778G / 天玑 8100 档。',
  },
  low: {
    id: 'low',
    label: '低端入门',
    cpu: 6,
    heap: 256,
    softGpu: true,
    oomWarnMb: 400,
    net: { latency: 150, down: 1.6e6, up: 750e3 },
    metrics: { width: 360, height: 800, dpr: 2 },
    description:
      'CPU 6× · JS 堆 256MB · SwiftShader 软渲染 · 弱 4G。对标 2+32 千元机冒烟档。',
  },
};

const DEFAULT_PRESET_ID = 'mid';

function getPreset(id) {
  return PRESETS[id] || PRESETS[DEFAULT_PRESET_ID];
}

function listPresets() {
  return Object.values(PRESETS).map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    heap: p.heap,
    softGpu: p.softGpu,
    cpu: p.cpu,
  }));
}

module.exports = {
  PRESETS,
  DEFAULT_PRESET_ID,
  getPreset,
  listPresets,
};
