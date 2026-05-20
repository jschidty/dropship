import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

const SHIP_CLASS_IDS = {
  fighter: 1,
  dropShip: 2,
  battleship: 3,
};
const PLAYERS = [
  { id: 1, color: "#74d9ff" },
  { id: 2, color: "#ff4fd8" },
];
const UNIT_SYMBOLS = [
  {
    id: "fighter",
    shipClassId: SHIP_CLASS_IDS.fighter,
    draw: drawIntuitionSdf,
  },
  {
    id: "drop-ship",
    shipClassId: SHIP_CLASS_IDS.dropShip,
    draw: drawLoopSdf,
  },
  {
    id: "battleship",
    shipClassId: SHIP_CLASS_IDS.battleship,
    draw: drawEldersSdf,
  },
];
const OUTPUT_ROOT = "packages/client/src/render/assets/unit-symbols";
const PI = Math.PI;
const TAU = PI * 2;
const CRC_TABLE = createCrcTable();

await Promise.all([
  ...PLAYERS.flatMap((player) =>
    UNIT_SYMBOLS.flatMap((symbol) => [
      writePng(
        join(OUTPUT_ROOT, "images", `player-${player.id}-${symbol.id}.png`),
        renderUnitSymbol({
          colorValue: player.color,
          draw: symbol.draw,
          size: 64,
          supersampleGrid: 2,
        })
      ),
      writePng(
        join(OUTPUT_ROOT, "textures", `player-${player.id}-${symbol.id}.png`),
        renderUnitSymbol({
          colorValue: player.color,
          draw: symbol.draw,
          size: 256,
          supersampleGrid: 3,
        })
      ),
    ])
  ),
  writePng(
    join(OUTPUT_ROOT, "textures", "selection-ring.png"),
    renderSelectionRing({ size: 128, supersampleGrid: 3 })
  ),
]);

console.log(`Baked unit symbol textures to ${OUTPUT_ROOT}`);

async function writePng(filePath, image) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, encodePng(image.width, image.height, image.data));
}

function renderUnitSymbol({ colorValue, draw, size, supersampleGrid }) {
  const color = parseHexColor(colorValue);
  const data = new Uint8Array(size * size * 4);
  const samples = supersampleGrid * supersampleGrid;
  const sampleStep = 1 / supersampleGrid;
  const sampleOffset = sampleStep * 0.5;

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
      data[pixel] = color.r;
      data[pixel + 1] = color.g;
      data[pixel + 2] = color.b;
      data[pixel + 3] = Math.round((coverage / samples) * 255);
    }
  }

  return { width: size, height: size, data };
}

function renderSelectionRing({ size, supersampleGrid }) {
  const data = new Uint8Array(size * size * 4);
  const samples = supersampleGrid * supersampleGrid;
  const sampleStep = 1 / supersampleGrid;
  const sampleOffset = sampleStep * 0.5;
  const scale = size / 128;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let outerCoverage = 0;
      let innerCoverage = 0;

      for (let sy = 0; sy < supersampleGrid; sy += 1) {
        for (let sx = 0; sx < supersampleGrid; sx += 1) {
          const sampleX = x + sx * sampleStep + sampleOffset;
          const sampleY = y + sy * sampleStep + sampleOffset;
          const distance = Math.hypot(sampleX - 64 * scale, sampleY - 64 * scale);

          if (Math.abs(distance - 56 * scale) <= 1.5 * scale) {
            outerCoverage += 1;
          }

          if (Math.abs(distance - 48 * scale) <= 4 * scale) {
            innerCoverage += 1;
          }
        }
      }

      const pixel = (y * size + x) * 4;
      const outerAlpha = (outerCoverage / samples) * 0.45;
      const innerAlpha = (innerCoverage / samples) * 0.98;
      const blended = blendOverTransparent(
        { r: 255, g: 137, b: 84, a: outerAlpha },
        { r: 252, g: 61, b: 33, a: innerAlpha }
      );

      data[pixel] = blended.r;
      data[pixel + 1] = blended.g;
      data[pixel + 2] = blended.b;
      data[pixel + 3] = blended.a;
    }
  }

  return { width: size, height: size, data };
}

function blendOverTransparent(first, second) {
  const alpha = second.a + first.a * (1 - second.a);

  if (alpha <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return {
    r: Math.round(
      (second.r * second.a + first.r * first.a * (1 - second.a)) / alpha
    ),
    g: Math.round(
      (second.g * second.a + first.g * first.a * (1 - second.a)) / alpha
    ),
    b: Math.round(
      (second.b * second.a + first.b * first.a * (1 - second.a)) / alpha
    ),
    a: Math.round(alpha * 255),
  };
}

function drawIntuitionSdf(st) {
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

function drawLoopSdf(st) {
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

function drawEldersSdf(st) {
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

function stroke(x, size, width) {
  return clamp01(step(size, x + width / 2) - step(size, x - width / 2));
}

function circleSDF(st) {
  return Math.hypot(st.x - 0.5, st.y - 0.5) * 2;
}

function fill(x, size) {
  return 1 - step(size, x);
}

function rectSDF(st, size) {
  const x = st.x * 2 - 1;
  const y = st.y * 2 - 1;

  return Math.max(Math.abs(x / size.x), Math.abs(y / size.y));
}

function vesicaSDF(st, width) {
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

function triSDF(st) {
  const x = (2 * st.x - 1) * 2;
  const y = (2 * st.y - 1) * 2;

  return Math.max(Math.abs(x) * 0.866025 + y * 0.5, -y * 0.5);
}

function rotate(st, angle) {
  const x = st.x - 0.5;
  const y = st.y - 0.5;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: cos * x - sin * y + 0.5,
    y: sin * x + cos * y + 0.5,
  };
}

function bridge(color, distance, size, width) {
  const filtered = color * (1 - stroke(distance, size, width * 2));

  return filtered + stroke(distance, size, width);
}

function offsetVec2(st, offset) {
  return {
    x: st.x + offset,
    y: st.y + offset,
  };
}

function subtractScalarFromVec2(scalar, st) {
  return {
    x: scalar - st.x,
    y: scalar - st.y,
  };
}

function mixVec2(first, second, amount) {
  return {
    x: mix(first.x, second.x, amount),
    y: mix(first.y, second.y, amount),
  };
}

function mix(first, second, amount) {
  return first * (1 - amount) + second * amount;
}

function step(edge, value) {
  return value < edge ? 0 : 1;
}

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

function parseHexColor(value) {
  const normalized = value.trim().replace(/^#/, "");

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Invalid hex color: ${value}`);
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = width * 4;
  const scanlines = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    scanlines[row] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      scanlines,
      row + 1
    );
  }

  return Buffer.concat([
    signature,
    encodeChunk("IHDR", header),
    encodeChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    encodeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodeChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createCrcTable() {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}
