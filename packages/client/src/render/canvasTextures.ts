import * as THREE from "three";
import {
  SHIP_CLASS_IDS,
  type PlayerId,
  type ShipClassId,
} from "@drop-ship/protocol";

export function createUnitSymbolTexture(
  colorValue: string,
  owner: PlayerId,
  shipClassId: ShipClassId | number
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create unit symbol canvas");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);

  if (shipClassId === SHIP_CLASS_IDS.battleship) {
    drawBattleshipSymbol(context, colorValue);
  } else if (shipClassId === SHIP_CLASS_IDS.dropShip) {
    drawDropShipSymbol(context, colorValue);
  } else {
    drawScoutSymbol(context, colorValue, owner);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function drawScoutSymbol(
  context: CanvasRenderingContext2D,
  colorValue: string,
  owner: PlayerId
): void {
  context.fillStyle = colorValue;
  context.beginPath();
  context.moveTo(128, 35);
  context.lineTo(212, 205);
  context.lineTo(128, 166);
  context.lineTo(44, 205);
  context.closePath();
  context.fill();

  context.strokeStyle = colorValue;
  context.lineJoin = "miter";
  context.lineWidth = owner === 1 ? 10 : 8;
  context.stroke();
}

function drawBattleshipSymbol(
  context: CanvasRenderingContext2D,
  colorValue: string
): void {
  context.strokeStyle = colorValue;
  context.lineCap = "square";
  context.lineJoin = "round";
  context.lineWidth = 22;
  context.beginPath();
  context.moveTo(83, 33);
  context.lineTo(83, 223);
  context.moveTo(83, 51);
  context.bezierCurveTo(189, 48, 206, 108, 111, 126);
  context.moveTo(83, 126);
  context.bezierCurveTo(214, 130, 204, 215, 83, 207);
  context.stroke();
}

function drawDropShipSymbol(
  context: CanvasRenderingContext2D,
  colorValue: string
): void {
  context.fillStyle = colorValue;
  context.fillRect(116, 35, 24, 186);
  context.fillRect(72, 76, 112, 24);
  context.fillRect(92, 197, 72, 24);
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
