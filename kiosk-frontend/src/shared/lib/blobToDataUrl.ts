/**
 * Blob → data URL(`data:<mime>;base64,...`). AuthArchive 발화 시 이미지 바이트를 IPC 로
 * 넘기기 위한 변환(자기서술 mime 이라 백엔드가 확장자를 정할 수 있다).
 */
export const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
