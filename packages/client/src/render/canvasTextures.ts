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
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create unit symbol canvas");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(4, 8, 16, 0.76)";
  context.fillRect(20, 20, 88, 88);

  context.strokeStyle = colorValue;
  context.lineWidth = 8;
  context.strokeRect(20, 20, 88, 88);

  if (shipClassId === SHIP_CLASS_IDS.battleship) {
    drawBattleshipSymbol(context, colorValue);
  } else if (shipClassId === SHIP_CLASS_IDS.dropShip) {
    drawDropShipSymbol(context, colorValue);
  } else {
    drawScoutSymbol(context, colorValue, owner);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function drawScoutSymbol(
  context: CanvasRenderingContext2D,
  colorValue: string,
  owner: PlayerId
): void {
  context.fillStyle = colorValue;
  context.beginPath();

  if (owner === 1) {
    context.moveTo(64, 30);
    context.lineTo(94, 96);
    context.lineTo(64, 82);
    context.lineTo(34, 96);
  } else {
    context.moveTo(64, 30);
    context.lineTo(96, 64);
    context.lineTo(64, 98);
    context.lineTo(32, 64);
  }

  context.closePath();
  context.fill();
}

function drawBattleshipSymbol(
  context: CanvasRenderingContext2D,
  colorValue: string
): void {
  context.fillStyle = colorValue;
  context.font = "700 68px Georgia, serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("β", 64, 67);
}

function drawDropShipSymbol(
  context: CanvasRenderingContext2D,
  colorValue: string
): void {
  context.fillStyle = colorValue;
  context.fillRect(58, 30, 12, 70);
  context.fillRect(38, 48, 52, 12);
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
