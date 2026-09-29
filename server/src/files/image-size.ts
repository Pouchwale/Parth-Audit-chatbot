export interface ImageSize {
  width: number;
  height: number;
}

/**
 * The size a PNG, GIF, WebP or JPEG image is shown at, read from its header. Null for anything else (HEIC would need
 * a native library) or a header that doesn't make sense.
 */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
  try {
    if (ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') return sized(view.getUint32(16), view.getUint32(20));
    if (ascii(0, 4) === 'GIF8') return sized(view.getUint16(6, true), view.getUint16(8, true));
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return webpSize(view, ascii(12, 4));
    if (view.getUint16(0) === 0xffd8) return jpegSize(view);
  } catch {
    // Reading past the end: a truncated or damaged header.
  }
  return null;
}

function sized(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function webpSize(view: DataView, chunk: string): ImageSize | null {
  const uint24 = (at: number) => view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
  if (chunk === 'VP8 ') return sized(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  if (chunk === 'VP8X') return sized(uint24(24) + 1, uint24(27) + 1);
  if (chunk === 'VP8L') {
    const bits = view.getUint32(21, true);
    return sized((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  return null;
}

// Start-of-frame markers, which hold the size: C0 to CF except C4 (DHT), C8 (JPG) and CC (DAC).
const START_OF_FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(view: DataView): ImageSize | null {
  let rotated = false;
  let at = 2;
  while (at + 9 < view.byteLength) {
    if (view.getUint8(at) !== 0xff) return null;
    const marker = view.getUint8(at + 1);
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Markers that stand alone, without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = view.getUint16(at + 2);
    if (marker === 0xe1) rotated ||= exifTurnsSideways(view, at + 4, length - 2);
    if (START_OF_FRAME.has(marker)) {
      const height = view.getUint16(at + 5);
      const width = view.getUint16(at + 7);
      return rotated ? sized(height, width) : sized(width, height);
    }
    at += 2 + length;
  }
  return null;
}

/** Whether an APP1 segment's EXIF orientation turns the picture a quarter turn, as phone cameras often do. */
function exifTurnsSideways(view: DataView, start: number, length: number): boolean {
  if (view.getUint32(start) !== 0x45786966) return false; // "Exif"
  const tiff = start + 6;
  const little = view.getUint16(tiff) === 0x4949; // "II"
  const firstIfd = tiff + view.getUint32(tiff + 4, little);
  const entries = view.getUint16(firstIfd, little);
  for (let i = 0; i < entries; i++) {
    const entry = firstIfd + 2 + i * 12;
    if (entry + 12 > start + length) return false;
    // Tag 0x0112 is the orientation; 5 to 8 are the ones that swap width and height.
    if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little) >= 5;
  }
  return false;
}
