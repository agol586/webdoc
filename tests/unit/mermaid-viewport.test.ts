import { describe, expect, it } from "vitest";

import { panViewBox, parseViewBox, zoomViewBox } from "../../src/components/mermaid-viewport";

describe("Mermaid viewport geometry", () => {
  it("parses an explicit SVG viewBox", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "10 20 300 150");

    expect(parseViewBox(svg)).toEqual({ x: 10, y: 20, width: 300, height: 150 });
  });

  it("falls back to numeric SVG dimensions", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "640");
    svg.setAttribute("height", "360");

    expect(parseViewBox(svg)).toEqual({ x: 0, y: 0, width: 640, height: 360 });
  });

  it("uses a safe fallback when SVG geometry is unavailable", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    expect(parseViewBox(svg)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("zooms around the center", () => {
    expect(zoomViewBox({ x: 0, y: 0, width: 100, height: 50 }, 0.8)).toEqual({
      x: 10,
      y: 5,
      width: 80,
      height: 40,
    });
  });

  it("converts pointer movement from pixels to diagram coordinates", () => {
    expect(panViewBox({ x: 0, y: 0, width: 100, height: 50 }, 20, 10, 200, 100)).toEqual({
      x: -10,
      y: -5,
      width: 100,
      height: 50,
    });
  });
});
