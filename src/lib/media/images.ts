import "server-only";
import sharp from "sharp";
import { MAX_IMAGE_DIMENSION } from "./limits";

export type ImageKind = "jpeg" | "png" | "webp" | "gif";

/**
 * Detects the real image type from the file's first bytes ("magic numbers") – the file name and
 * the browser-reported type can be faked. SVG is deliberately not supported (it can contain scripts).
 */
export function detectImageType(bytes: Uint8Array): ImageKind | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return "jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "gif";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

/**
 * Normalises an upload: applies the camera's rotation, scales it down to MAX_IMAGE_DIMENSION and
 * re-encodes it as WebP. Re-encoding drops all metadata (EXIF/GPS location, camera serials) –
 * important for GDPR, since phone photos often contain where they were taken.
 */
export async function processImage(input: Uint8Array) {
  const { data, info } = await sharp(input, { animated: false, limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, contentType: "image/webp" as const, extension: "webp" };
}
