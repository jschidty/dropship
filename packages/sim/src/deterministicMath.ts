export const SIM_PI = 3.141592653589793;
export const SIM_HALF_PI = SIM_PI / 2;
export const SIM_TAU = SIM_PI * 2;

const SIN_TABLE_SIZE = 1024;
const SIN_TABLE_SCALE = 32767;
const SIM_FLOAT_QUANTUM = 0.000001;
const SQRT_ITERATIONS = 20;
const EPSILON = 0.000000000001;
const SIN_TABLE_BASE64 =
  "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";

const SIN_TABLE = decodeSineTable(SIN_TABLE_BASE64);

export function deterministicSin(angleRadians: number): number {
  const tablePosition = normalizeRadians(angleRadians) * (SIN_TABLE_SIZE / SIM_TAU);
  const lowerIndex = deterministicFloor(tablePosition);
  const fraction = tablePosition - lowerIndex;
  const lower = SIN_TABLE[lowerIndex];
  const upper = SIN_TABLE[lowerIndex + 1];

  return quantizeSimFloat(lower + (upper - lower) * fraction);
}

export function deterministicCos(angleRadians: number): number {
  return deterministicSin(angleRadians + SIM_HALF_PI);
}

export function deterministicAtan2(y: number, x: number): number {
  if (x === 0 && y === 0) {
    return 0;
  }

  if (x === 0) {
    return y > 0 ? SIM_HALF_PI : -SIM_HALF_PI;
  }

  const absY = y < 0 ? -y : y;
  let angle: number;

  if (x >= 0) {
    const ratio = (x - absY) / (x + absY + EPSILON);
    angle = SIM_PI / 4 - (SIM_PI / 4) * ratio;
  } else {
    const ratio = (x + absY) / (absY - x + EPSILON);
    angle = (SIM_PI * 3) / 4 - (SIM_PI / 4) * ratio;
  }

  return quantizeSimFloat(y < 0 ? -angle : angle);
}

export function deterministicSqrt(value: number): number {
  if (value <= 0) {
    return 0;
  }

  let estimate = value >= 1 ? value : 1;

  for (let index = 0; index < SQRT_ITERATIONS; index += 1) {
    estimate = (estimate + value / estimate) * 0.5;
  }

  return quantizeSimFloat(estimate);
}

export function deterministicFloor(value: number): number {
  return Math.floor(value);
}

export function deterministicSquare(value: number): number {
  return quantizeSimFloat(value * value);
}

export function quantizeSimFloat(value: number): number {
  const quantized = Math.round(value / SIM_FLOAT_QUANTUM) * SIM_FLOAT_QUANTUM;
  return Object.is(quantized, -0) ? 0 : quantized;
}

function normalizeRadians(angleRadians: number): number {
  const wrapped = angleRadians % SIM_TAU;
  return wrapped < 0 ? wrapped + SIM_TAU : wrapped;
}

function decodeSineTable(base64: string): readonly number[] {
  const binary = atob(base64);
  const table: number[] = [];

  for (let index = 0; index < binary.length; index += 2) {
    let value =
      binary.charCodeAt(index) | (binary.charCodeAt(index + 1) << 8);

    if (value & 0x8000) {
      value -= 0x1_0000;
    }

    table.push(value / SIN_TABLE_SCALE);
  }

  return table;
}
