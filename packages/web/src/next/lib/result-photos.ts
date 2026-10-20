/** 데이터 주소로 표시할 수 있는 사진의 형식과 크기를 확인한다. */
export const MAX_PHOTO_CHARS = 4 * 1024 * 1024;
const SAFE_TYPE = /^image\/(png|jpeg|webp)$/;

export function photoUrl(
  shot: { mediaType: string; data: string } | null | undefined,
): string | null {
  if (!shot || shot.data.length === 0 || shot.data.length > MAX_PHOTO_CHARS) return null;
  if (!SAFE_TYPE.test(shot.mediaType)) return null;
  return `data:${shot.mediaType};base64,${shot.data}`;
}
