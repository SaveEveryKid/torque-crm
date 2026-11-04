/**
 * YOUR OWN PHOTOS for a Marketplace listing. Each one gets the store's logo
 * (the same Shoals Outdoor Sports logo the website puts on its inventory
 * photos) in the bottom-right corner, like the dealer photos, and is saved
 * at Facebook's size (2048 px on the long side). Nothing else about the
 * photo changes. The extension then adds your watermarks in the other
 * corners, the same as on every other photo.
 */
const MAX_SIDE = 2048;
const LOGO_URL = '/store-logo.png';

let logo: Promise<ImageBitmap> | null = null;
function storeLogo(): Promise<ImageBitmap> {
  logo =
    logo ??
    fetch(LOGO_URL)
      .then((r) => {
        if (!r.ok) throw new Error('The store logo is missing.');
        return r.blob();
      })
      .then((b) => createImageBitmap(b))
      .catch((e) => {
        logo = null;
        throw e;
      });
  return logo;
}

/** Where the logo goes: bottom-right, about a fifth of the photo's width (a bit more on tall photos), like the website's. */
export function logoPlacement(W: number, H: number, logoW: number, logoH: number) {
  const w = Math.round(W * (W >= H ? 0.21 : 0.3));
  const h = Math.round((w * logoH) / logoW);
  const margin = Math.round(Math.min(W, H) * 0.03);
  return { x: W - w - margin, y: H - h - margin, w, h };
}

/** One of your photos, ready to list: upright, Facebook-sized, with the store logo. A JPEG data URL. */
export async function prepareOwnPhoto(file: Blob): Promise<string> {
  // Phones save some photos sideways with a "turn me" note: honour it.
  const photo = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error("That file isn't a photo Chrome can open (JPEG, PNG or WebP).");
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(photo.width, photo.height));
  const W = Math.round(photo.width * scale);
  const H = Math.round(photo.height * scale);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(photo, 0, 0, W, H);
  photo.close();
  const l = await storeLogo();
  const p = logoPlacement(W, H, l.width, l.height);
  x.drawImage(l, p.x, p.y, p.w, p.h);
  return c.toDataURL('image/jpeg', 0.9);
}
