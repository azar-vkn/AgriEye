// Thin line icons drawn inline (no icon font), 24×24, stroke = currentColor.
const PATHS = {
  agriculture:
    '<path d="M12 21V8"/><path d="M12 8c-2.2 0-4-1.8-4-4 2.2 0 4 1.8 4 4Zm0 0c2.2 0 4-1.8 4-4-2.2 0-4 1.8-4 4Z"/><path d="M12 13c-2.2 0-4-1.8-4-4 2.2 0 4 1.8 4 4Zm0 0c2.2 0 4-1.8 4-4-2.2 0-4 1.8-4 4Z"/><path d="M12 18c-2.2 0-4-1.8-4-4 2.2 0 4 1.8 4 4Zm0 0c2.2 0 4-1.8 4-4-2.2 0-4 1.8-4 4Z"/>',
  soil: '<path d="M12 3s-4 4.6-4 7.5a4 4 0 0 0 8 0C16 7.6 12 3 12 3Z"/><path d="M3 17h18M5 21h14"/>',
  vegetation: '<path d="M5 20c0-8 5-14 15-15-1 10-7 15-15 15Z"/><path d="M5 20c3-4 6-7 10-10"/>',
  weather: '<path d="M7 15a4 4 0 1 1 1.2-7.8A5 5 0 0 1 18 9a3 3 0 0 1 0 6Z"/><path d="M9 18l-1 2M13 18l-1 2M17 18l-1 2"/>',
  solar: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  heat: '<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0Z"/><path d="M12 11v6"/>',
  risk: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  send: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  home: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m12 6 2.5 6h-5L12 6Z" fill="currentColor"/><path d="M9.5 12 12 18l2.5-6"/>',
  extrude: '<path d="M4 16 12 20l8-4M4 12l8 4 8-4M12 4l8 4-8 4-8-4 8-4Z"/>',
  map: '<path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z"/><path d="M9 4v14M15 6v14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.3"/>',
  speaker: '<path d="M4 10v4h4l5 4V6L8 10H4Z"/><path d="M16.5 9a4 4 0 0 1 0 6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  satellite: '<path d="m6 6 4 4M14 14l4 4"/><rect x="8.5" y="8.5" width="7" height="7" rx="1" transform="rotate(45 12 12)"/><path d="M4 4l3 3M17 17l3 3M18 6a8 8 0 0 1 0 0"/>',
};

export function icon(name, { size = 18, label = '' } = {}) {
  const body = PATHS[name] || PATHS.info;
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="ae-icon" ${a11y} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
