import * as THREE from "three";
import {
  SHIP_CLASS_IDS,
  type PlayerId,
  type ShipClassId,
} from "@drop-ship/protocol";

const UNIT_SYMBOL_TEXTURE_SIZE = 256;
const UNIT_SYMBOL_TEXTURE_SUPERSAMPLE_GRID = 3;
const UNIT_SYMBOL_IMAGE_SIZE = 64;
const UNIT_SYMBOL_IMAGE_SUPERSAMPLE_GRID = 2;
const PI = Math.PI;
const TAU = PI * 2;
const UNIT_SYMBOL_IMAGE_URLS = new Map<string, string>();
const DEFAULT_PLAYER_ONE_COLOR = "#74d9ff";
const DEFAULT_PLAYER_TWO_COLOR = "#ff4fd8";
const TEXTURE_LOADER = new THREE.TextureLoader();
const BAKED_SELECTION_RING_TEXTURE_URL = new URL(
  "./assets/unit-symbols/textures/selection-ring.png",
  import.meta.url
).href;
const BAKED_UNIT_SYMBOL_ASSETS = new Map<
  string,
  Readonly<{ imageUrl: string; textureUrl: string }>
>([
  createBakedUnitSymbolAsset(
    DEFAULT_PLAYER_ONE_COLOR,
    1,
    SHIP_CLASS_IDS.fighter,
    new URL("./assets/unit-symbols/images/player-1-fighter.png", import.meta.url)
      .href,
    new URL(
      "./assets/unit-symbols/textures/player-1-fighter.png",
      import.meta.url
    ).href
  ),
  createBakedUnitSymbolAsset(
    DEFAULT_PLAYER_ONE_COLOR,
    1,
    SHIP_CLASS_IDS.dropShip,
    new URL(
      "./assets/unit-symbols/images/player-1-drop-ship.png",
      import.meta.url
    ).href,
    new URL(
      "./assets/unit-symbols/textures/player-1-drop-ship.png",
      import.meta.url
    ).href
  ),
  createBakedUnitSymbolAsset(
    DEFAULT_PLAYER_ONE_COLOR,
    1,
    SHIP_CLASS_IDS.battleship,
    new URL(
      "./assets/unit-symbols/images/player-1-battleship.png",
      import.meta.url
    ).href,
    new URL(
      "./assets/unit-symbols/textures/player-1-battleship.png",
      import.meta.url
    ).href
  ),
  createBakedUnitSymbolAsset(
    DEFAULT_PLAYER_TWO_COLOR,
    2,
    SHIP_CLASS_IDS.fighter,
    new URL("./assets/unit-symbols/images/player-2-fighter.png", import.meta.url)
      .href,
    new URL(
      "./assets/unit-symbols/textures/player-2-fighter.png",
      import.meta.url
    ).href
  ),
  createBakedUnitSymbolAsset(
    DEFAULT_PLAYER_TWO_COLOR,
    2,
    SHIP_CLASS_IDS.dropShip,
    new URL(
      "./assets/unit-symbols/images/player-2-drop-ship.png",
      import.meta.url
    ).href,
    new URL(
      "./assets/unit-symbols/textures/player-2-drop-ship.png",
      import.meta.url
    ).href
  ),
  createBakedUnitSymbolAsset(
    DEFAULT_PLAYER_TWO_COLOR,
    2,
    SHIP_CLASS_IDS.battleship,
    new URL(
      "./assets/unit-symbols/images/player-2-battleship.png",
      import.meta.url
    ).href,
    new URL(
      "./assets/unit-symbols/textures/player-2-battleship.png",
      import.meta.url
    ).href
  ),
]);

export function createUnitSymbolTexture(
  colorValue: string,
  owner: PlayerId,
  shipClassId: ShipClassId | number
): THREE.Texture {
  const bakedAsset = BAKED_UNIT_SYMBOL_ASSETS.get(
    createUnitSymbolKey(colorValue, owner, shipClassId)
  );
  const texture = bakedAsset
    ? TEXTURE_LOADER.load(bakedAsset.textureUrl)
    : new THREE.CanvasTexture(
        createUnitSymbolCanvas(
          colorValue,
          owner,
          shipClassId,
          UNIT_SYMBOL_TEXTURE_SIZE,
          UNIT_SYMBOL_TEXTURE_SUPERSAMPLE_GRID
        )
      );

  configureUnitSymbolTexture(texture);
  return texture;
}

function configureUnitSymbolTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
}

export function createUnitSymbolImageUrl(
  colorValue: string,
  owner: PlayerId,
  shipClassId: ShipClassId | number
): string {
  const key = createUnitSymbolKey(colorValue, owner, shipClassId);
  const bakedAsset = BAKED_UNIT_SYMBOL_ASSETS.get(key);

  if (bakedAsset) {
    return bakedAsset.imageUrl;
  }

  const cached = UNIT_SYMBOL_IMAGE_URLS.get(key);

  if (cached) {
    return cached;
  }

  const imageUrl = createUnitSymbolCanvas(
    colorValue,
    owner,
    shipClassId,
    UNIT_SYMBOL_IMAGE_SIZE,
    UNIT_SYMBOL_IMAGE_SUPERSAMPLE_GRID
  ).toDataURL("image/png");
  UNIT_SYMBOL_IMAGE_URLS.set(key, imageUrl);
  return imageUrl;
}

function createUnitSymbolKey(
  colorValue: string,
  owner: PlayerId,
  shipClassId: ShipClassId | number
): string {
  return `${colorValue.trim().toLowerCase()}:${owner}:${shipClassId}`;
}

function createBakedUnitSymbolAsset(
  colorValue: string,
  owner: PlayerId,
  shipClassId: ShipClassId | number,
  imageUrl: string,
  textureUrl: string
): readonly [
  string,
  Readonly<{
    imageUrl: string;
    textureUrl: string;
  }>,
] {
  return [
    createUnitSymbolKey(colorValue, owner, shipClassId),
    {
      imageUrl,
      textureUrl,
    },
  ];
}

function createUnitSymbolCanvas(
  colorValue: string,
  owner: PlayerId,
  shipClassId: ShipClassId | number,
  size: number,
  supersampleGrid: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create unit symbol canvas");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  void owner;

  if (shipClassId === SHIP_CLASS_IDS.battleship) {
    drawSdfSymbol(context, size, supersampleGrid, colorValue, drawEldersSdf);
  } else if (shipClassId === SHIP_CLASS_IDS.dropShip) {
    drawSdfSymbol(context, size, supersampleGrid, colorValue, drawLoopSdf);
  } else {
    drawSdfSymbol(context, size, supersampleGrid, colorValue, drawIntuitionSdf);
  }

  return canvas;
}

function drawSdfSymbol(
  context: CanvasRenderingContext2D,
  size: number,
  supersampleGrid: number,
  colorValue: string,
  draw: (st: Vec2) => number
): void {
  const color = new THREE.Color(colorValue);
  const image = context.createImageData(size, size);
  const samples = supersampleGrid * supersampleGrid;
  const sampleStep = 1 / supersampleGrid;
  const sampleOffset = sampleStep * 0.5;
  const red = Math.round(color.r * 255);
  const green = Math.round(color.g * 255);
  const blue = Math.round(color.b * 255);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let coverage = 0;

      for (let sy = 0; sy < supersampleGrid; sy += 1) {
        for (let sx = 0; sx < supersampleGrid; sx += 1) {
          coverage += clamp01(
            draw({
              x: (x + sx * sampleStep + sampleOffset) / size,
              y: 1 - (y + sy * sampleStep + sampleOffset) / size,
            })
          );
        }
      }

      const pixel = (y * size + x) * 4;
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

export function createSelectionRingTexture(): THREE.Texture {
  const bakedTexture = TEXTURE_LOADER.load(BAKED_SELECTION_RING_TEXTURE_URL);
  bakedTexture.colorSpace = THREE.SRGBColorSpace;
  bakedTexture.generateMipmaps = false;
  bakedTexture.minFilter = THREE.LinearFilter;
  bakedTexture.magFilter = THREE.LinearFilter;
  return bakedTexture;
}

export function createFallbackSelectionRingTexture(): THREE.CanvasTexture {
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
