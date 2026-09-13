export const CAPTURE_TAG = "capture-incomplete";
export const CAPTURE_TIMEOUT_MS = 30_000;
export const RESOURCE_TIMEOUT_MS = 8_000;
export const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;

export async function withTimeout(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function imageDataUrlToBlob(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl ?? "");
  if (!match || match[2].length > MAX_RESOURCE_BYTES * 1.4) {
    throw new Error("Image unavailable or too large");
  }
  const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
}

export async function readLimitedResponse(response, limit = MAX_RESOURCE_BYTES) {
  if (!response.ok) throw new Error(`Resource returned HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > limit) {
    throw new Error("Resource too large");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Resource too large");
      chunks.push(value);
    }
    return new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    // Avoid TypedArray.subarray's species/constructor lookup across Firefox's
    // content-script compartments (it can throw a permission error).
    let chunk = "";
    for (let i = offset; i < Math.min(offset + 8192, bytes.length); i++) chunk += String.fromCharCode(bytes[i]);
    binary += chunk;
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
