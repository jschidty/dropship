export function createSelectionBox(container: HTMLElement): HTMLElement {
  const selectionBox = document.createElement("div");
  selectionBox.className = "selection-box";
  selectionBox.hidden = true;
  container.appendChild(selectionBox);
  return selectionBox;
}

export function updateSelectionBox(
  selectionBox: HTMLElement,
  container: HTMLElement,
  startClientX: number,
  startClientY: number,
  endClientX: number,
  endClientY: number
): void {
  const bounds = container.getBoundingClientRect();
  const left = Math.min(startClientX, endClientX) - bounds.left;
  const top = Math.min(startClientY, endClientY) - bounds.top;
  const width = Math.abs(endClientX - startClientX);
  const height = Math.abs(endClientY - startClientY);

  selectionBox.hidden = false;
  selectionBox.style.transform = `translate(${left}px, ${top}px)`;
  selectionBox.style.width = `${width}px`;
  selectionBox.style.height = `${height}px`;
}

export function hideSelectionBox(selectionBox: HTMLElement): void {
  selectionBox.hidden = true;
  selectionBox.style.width = "0";
  selectionBox.style.height = "0";
}
