// Minimal ESRI Shapefile (.shp polygon) and dBASE (.dbf) readers for the
// one-time AgriEye boundary preparation. Only what the datameet files use.

/** Read dBASE III records into plain objects keyed by trimmed field name. */
export function readDbf(buffer) {
  const count = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];
  for (let offset = 32; buffer[offset] !== 0x0d; offset += 32) {
    const name = buffer
      .toString('latin1', offset, offset + 11)
      .replace(/\0.*$/s, '')
      .trim();
    fields.push({ name, length: buffer[offset + 16] });
  }
  const records = [];
  for (let index = 0; index < count; index += 1) {
    let cursor = headerLength + index * recordLength + 1;
    const record = {};
    for (const field of fields) {
      record[field.name] = buffer
        .toString('utf8', cursor, cursor + field.length)
        .trim();
      cursor += field.length;
    }
    records.push(record);
  }
  return records;
}

/** Read polygon records (shape type 5) as arrays of rings of [lon, lat]. */
export function readPolygonShp(buffer) {
  const shapes = [];
  let offset = 100;
  while (offset + 8 <= buffer.length) {
    const contentLength = buffer.readInt32BE(offset + 4) * 2;
    const start = offset + 8;
    const type = buffer.readInt32LE(start);
    if (type === 0) {
      shapes.push([]);
    } else if (type === 5 || type === 15 || type === 25) {
      const partCount = buffer.readInt32LE(start + 36);
      const pointCount = buffer.readInt32LE(start + 40);
      const partsAt = start + 44;
      const pointsAt = partsAt + partCount * 4;
      const parts = [];
      for (let part = 0; part < partCount; part += 1)
        parts.push(buffer.readInt32LE(partsAt + part * 4));
      parts.push(pointCount);
      const rings = [];
      for (let part = 0; part < partCount; part += 1) {
        const ring = [];
        for (let point = parts[part]; point < parts[part + 1]; point += 1) {
          const at = pointsAt + point * 16;
          ring.push([buffer.readDoubleLE(at), buffer.readDoubleLE(at + 8)]);
        }
        rings.push(ring);
      }
      shapes.push(rings);
    } else {
      throw new Error(`Unsupported shape type ${type}`);
    }
    offset = start + contentLength;
  }
  return shapes;
}
