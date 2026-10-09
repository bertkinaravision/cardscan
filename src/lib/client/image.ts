// Decodes a photo in whichever way this browser supports, keeping the camera's EXIF rotation.
async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
  } catch {
    // Older Safari rejects the options, and some formats (HEIC) only decode through <img>,
    // which applies EXIF rotation in every current browser.
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

// Shrinks a camera photo to at most 1600px on the long side and re-encodes it as JPEG.
export async function compressImage(file: Blob, maxSide = 1600, quality = 0.82): Promise<Blob> {
  const img = await decode(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const width = Math.round(img.width * scale);
    const height = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // transparent PNG screenshots would otherwise turn black in JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img.source, 0, 0, width, height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not compress photo."))), "image/jpeg", quality),
    );
  } finally {
    img.done();
  }
}
