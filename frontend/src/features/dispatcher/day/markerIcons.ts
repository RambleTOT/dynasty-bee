/**
 * Иконки внутри маркеров Leaflet: `divIcon` принимает HTML-строку, поэтому пути lucide
 * (zap, check, building-2) — здесь строками. Цвет — currentColor из CSS.
 */
const svg = (paths: string[], size: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths
    .map((d) => `<path d="${d}"/>`)
    .join('')}</svg>`;

export const ZAP_SVG = (size = 16) =>
  svg(
    [
      'M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z',
    ],
    size,
  );

export const CHECK_SVG = (size = 14) => svg(['M20 6 9 17l-5-5'], size);

export const BUILDING_SVG = (size = 16) =>
  svg(
    [
      'M10 12h4',
      'M10 8h4',
      'M14 21v-3a2 2 0 0 0-4 0v3',
      'M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2',
      'M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16',
    ],
    size,
  );
