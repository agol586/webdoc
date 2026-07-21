export type ViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const FALLBACK_VIEW_BOX: ViewBox = { x: 0, y: 0, width: 100, height: 100 };

export function parseViewBox(svg: SVGSVGElement): ViewBox {
  const values = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (
    values?.length === 4
    && values.every(Number.isFinite)
    && values[2] > 0
    && values[3] > 0
  ) {
    return { x: values[0], y: values[1], width: values[2], height: values[3] };
  }

  const width = Number(svg.getAttribute("width"));
  const height = Number(svg.getAttribute("height"));
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { x: 0, y: 0, width, height };
  }

  return { ...FALLBACK_VIEW_BOX };
}

export function zoomViewBox(viewBox: ViewBox, factor: number): ViewBox {
  const width = viewBox.width * factor;
  const height = viewBox.height * factor;
  return {
    x: viewBox.x + (viewBox.width - width) / 2,
    y: viewBox.y + (viewBox.height - height) / 2,
    width,
    height,
  };
}

export function panViewBox(
  viewBox: ViewBox,
  dxPixels: number,
  dyPixels: number,
  widthPixels: number,
  heightPixels: number,
): ViewBox {
  return {
    ...viewBox,
    x: viewBox.x - (dxPixels / widthPixels) * viewBox.width,
    y: viewBox.y - (dyPixels / heightPixels) * viewBox.height,
  };
}
