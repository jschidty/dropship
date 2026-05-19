import * as THREE from "three";
import {
  SHIP_CLASS_IDS,
  type PlayerId,
  type ShipClassId,
} from "@drop-ship/protocol";

const SDF_TEXTURE_SIZE = 256;
const SDF_SUPERSAMPLE_GRID = 3;
const PI = Math.PI;
const TAU = PI * 2;
const UNIT_SYMBOL_IMAGE_URLS = new Map<string, string>();

export function createUnitSymbolTexture(
  colorValue: string,
  owner: PlayerId,
  shipClassId: ShipClassId | number
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(
    createUnitSymbolCanvas(colorValue, owner, shipClassId)
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

export function createUnitSymbolImageUrl(
  colorValue: string,
  owner: PlayerId,
  shipClassId: ShipClassId | number
): string {
  const key = `${colorValue}:${owner}:${shipClassId}`;
  const cached = UNIT_SYMBOL_IMAGE_URLS.get(key);

  if (cached) {
    return cached;
  }

  const imageUrl = createUnitSymbolCanvas(
    colorValue,
    owner,
    shipClassId
  ).toDataURL("image/png");
  UNIT_SYMBOL_IMAGE_URLS.set(key, imageUrl);
  return imageUrl;
}

function createUnitSymbolCanvas(
  colorValue: string,
  owner: PlayerId,
  shipClassId: ShipClassId | number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SDF_TEXTURE_SIZE;
  canvas.height = SDF_TEXTURE_SIZE;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create unit symbol canvas");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  void owner;

  if (shipClassId === SHIP_CLASS_IDS.battleship) {
    drawSdfSymbol(context, colorValue, drawEldersSdf);
  } else if (shipClassId === SHIP_CLASS_IDS.dropShip) {
    drawSdfSymbol(context, colorValue, drawLoopSdf);
  } else {
    drawSdfSymbol(context, colorValue, drawIntuitionSdf);
  }

  return canvas;
}

function drawSdfSymbol(
  context: CanvasRenderingContext2D,
  colorValue: string,
  draw: (st: Vec2) => number
): void {
  const color = new THREE.Color(colorValue);
  const image = context.createImageData(SDF_TEXTURE_SIZE, SDF_TEXTURE_SIZE);
  const samples = SDF_SUPERSAMPLE_GRID * SDF_SUPERSAMPLE_GRID;
  const sampleStep = 1 / SDF_SUPERSAMPLE_GRID;
  const sampleOffset = sampleStep * 0.5;
  const red = Math.round(color.r * 255);
  const green = Math.round(color.g * 255);
  const blue = Math.round(color.b * 255);

  for (let y = 0; y < SDF_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < SDF_TEXTURE_SIZE; x += 1) {
      let coverage = 0;

      for (let sy = 0; sy < SDF_SUPERSAMPLE_GRID; sy += 1) {
        for (let sx = 0; sx < SDF_SUPERSAMPLE_GRID; sx += 1) {
          coverage += clamp01(
            draw({
              x: (x + sx * sampleStep + sampleOffset) / SDF_TEXTURE_SIZE,
              y: 1 - (y + sy * sampleStep + sampleOffset) / SDF_TEXTURE_SIZE,
            })
          );
        }
      }

      const pixel = (y * SDF_TEXTURE_SIZE + x) * 4;
      image.data[pixel] = red;
      image.data[pixel + 1] = green;
      image.data[pixel + 2] = blue;
      image.data[pixel + 3] = Math.round((coverage / samples) * 255);
    }
  }

  context.putImageData(image, 0, 0);
}

type Vec2 = {
  x: number;
  y: number;
};

function drawIntuitionSdf(st: Vec2): number {
  const rotated = rotate(st, -25 * (PI / 180));
  const sdf = triSDF(rotated);
  const divisor = triSDF({
    x: rotated.x,
    y: rotated.y + 0.2,
  });

  if (Math.abs(divisor) <= 0.000001) {
    return 0;
  }

  return fill(Math.abs(sdf / divisor), 0.56);
}

function drawLoopSdf(st: Vec2): number {
  const inv = step(0.5, st.y);
  let current = offsetVec2(rotate(st, -45 * (PI / 180)), -0.2);
  current = mixVec2(
    current,
    subtractScalarFromVec2(0.6, current),
    step(0.5, inv)
  );
  let color = 0;

  for (let index = 0; index < 5; index += 1) {
    const rect = rectSDF(current, { x: 1, y: 1 });
    const size = 0.25 - Math.abs(index * 0.1 - 0.2);
    color = bridge(color, rect, size, 0.05);
    current = offsetVec2(current, 0.1);
  }

  return color;
}

function drawEldersSdf(st: Vec2): number {
  const count = 3;
  const angle = TAU / count;
  let color = 0;

  for (let index = 0; index < count * 2; index += 1) {
    const xy = rotate(st, angle * index);
    xy.y -= 0.09;

    const vesica = vesicaSDF(xy, 0.3);
    color = mix(
      color + stroke(vesica, 0.5, 0.1),
      mix(
        color,
        bridge(color, vesica, 0.5, 0.1),
        step(xy.x, 0.5) - step(xy.y, 0.4)
      ),
      step(3, index)
    );
  }

  return color;
}

function stroke(x: number, size: number, width: number): number {
  return clamp01(step(size, x + width / 2) - step(size, x - width / 2));
}

function circleSDF(st: Vec2): number {
  return Math.hypot(st.x - 0.5, st.y - 0.5) * 2;
}

function fill(x: number, size: number): number {
  return 1 - step(size, x);
}

function rectSDF(st: Vec2, size: Vec2): number {
  const x = st.x * 2 - 1;
  const y = st.y * 2 - 1;

  return Math.max(Math.abs(x / size.x), Math.abs(y / size.y));
}

function vesicaSDF(st: Vec2, width: number): number {
  const offset = width * 0.5;

  return Math.max(
    circleSDF({
      x: st.x - offset,
      y: st.y,
    }),
    circleSDF({
      x: st.x + offset,
      y: st.y,
    })
  );
}

function triSDF(st: Vec2): number {
  const x = (2 * st.x - 1) * 2;
  const y = (2 * st.y - 1) * 2;

  return Math.max(Math.abs(x) * 0.866025 + y * 0.5, -y * 0.5);
}

function rotate(st: Vec2, angle: number): Vec2 {
  const x = st.x - 0.5;
  const y = st.y - 0.5;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: cos * x - sin * y + 0.5,
    y: sin * x + cos * y + 0.5,
  };
}

function bridge(
  color: number,
  distance: number,
  size: number,
  width: number
): number {
  const filtered = color * (1 - stroke(distance, size, width * 2));

  return filtered + stroke(distance, size, width);
}

function offsetVec2(st: Vec2, offset: number): Vec2 {
  return {
    x: st.x + offset,
    y: st.y + offset,
  };
}

function subtractScalarFromVec2(scalar: number, st: Vec2): Vec2 {
  return {
    x: scalar - st.x,
    y: scalar - st.y,
  };
}

function mixVec2(first: Vec2, second: Vec2, amount: number): Vec2 {
  return {
    x: mix(first.x, second.x, amount),
    y: mix(first.y, second.y, amount),
  };
}

function mix(first: number, second: number, amount: number): number {
  return first * (1 - amount) + second * amount;
}

function step(edge: number, value: number): number {
  return value < edge ? 0 : 1;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

export function createSelectionRingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create selection ring canvas");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(252, 61, 33, 0.98)";
  context.lineWidth = 8;
  context.beginPath();
  context.arc(64, 64, 48, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = "rgba(255, 137, 84, 0.45)";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(64, 64, 56, 0, Math.PI * 2);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
