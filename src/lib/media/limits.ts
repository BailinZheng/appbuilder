// Shared by the upload area (client-side pre-check) and the server (the real check).

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMAGE_DIMENSION = 2000; // px, longest side after processing
export const MAX_IMAGES_PER_APP = 100;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Public URL path of a stored image, e.g. /media/abc123.webp – works on the platform and every subdomain. */
export const mediaPath = (id: string, extension: string) => `/media/${id}.${extension}`;
