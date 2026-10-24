// On-device photo processing (no cloud storage needed):
//  - prepareForUpload: downsizes to at most 1600 px and re-encodes as JPEG so uploads
//    stay well under the API host's request limit (Vercel: 4.5 MB). eBay recommends
//    at least 500 px on the long side; 1600 px is eBay's zoom size.
//  - makeThumbnail: a ~240 px JPEG data URL saved with the listing (Firestore), so
//    My Listings can show a preview even after an unused eBay-hosted photo expires.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const MAX_SIDE = 1600;
const THUMB_WIDTH = 240;

export async function prepareForUpload(asset) {
  const ctx = ImageManipulator.manipulate(asset.uri);
  const w = asset.width || 0;
  const h = asset.height || 0;
  if (!w || !h || Math.max(w, h) > MAX_SIDE) {
    ctx.resize(w >= h ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return { uri: out.uri, mimeType: 'image/jpeg', width: out.width, height: out.height };
}

export async function makeThumbnail(localUri) {
  const ctx = ImageManipulator.manipulate(localUri);
  ctx.resize({ width: THUMB_WIDTH });
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
  return out.base64 ? `data:image/jpeg;base64,${out.base64}` : null;
}
