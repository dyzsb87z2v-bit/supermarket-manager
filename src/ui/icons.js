// Inline stroke icons (24x24). Built with createElementNS, no markup strings.
const PATHS = {
  home: ['M3 11l9-8 9 8', 'M5 10v10h5v-6h4v6h5V10'],
  box: ['M21 8l-9-5-9 5v8l9 5 9-5z', 'M3 8l9 5 9-5', 'M12 13v8'],
  swap: ['M7 4v14', 'M3 14l4 4 4-4', 'M17 20V6', 'M13 10l4-4 4 4'],
  clipboard: ['M9 3h6v4H9z', 'M7 5H5v16h14V5h-2', 'M8 12h8', 'M8 16h5'],
  chart: ['M4 20V11', 'M10 20V4', 'M16 20v-6', 'M2 20h20'],
  sliders: ['M4 6h9', 'M17 6h3', 'M4 12h3', 'M11 12h9', 'M4 18h11', 'M19 18h1', 'M13 4v4', 'M7 10v4', 'M15 16v4'],
  plus: ['M12 5v14', 'M5 12h14'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  copy: ['M9 9h11v11H9z', 'M5 15V4h11'],
  share: ['M12 3v12', 'M8 7l4-4 4 4', 'M5 12v8h14v-8'],
  phone: ['M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  alert: ['M12 3l10 18H2z', 'M12 10v5', 'M12 18h.01'],
};

export function icon(name, size = 22) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v);
  for (const d of PATHS[name] ?? []) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
