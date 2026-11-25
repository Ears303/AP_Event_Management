// Turns an uploaded sponsor logo (JPEG, PNG or the first page of a PDF) into a web-sized image blob.
// Everything happens in the browser; the result is uploaded to Supabase Storage by the caller.

export const LOGO_MAX_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 800; // longest side in pixels - plenty for a TV tile, small enough to load fast

export type LogoBlob = { blob: Blob; ext: "jpg" | "png"; contentType: string; width: number; height: number };

export function logoKind(file: File): "pdf" | "jpeg" | "png" | null {
  const n = file.name.toLowerCase();
  if (file.type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (file.type === "image/jpeg" || /\.jpe?g$/.test(n)) return "jpeg";
  if (file.type === "image/png" || n.endsWith(".png")) return "png";
  return null;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not convert the image."))), type, quality));
}

function fit(w: number, h: number) {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

async function pdfFirstPageCanvas(file: File): Promise<HTMLCanvasElement> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const { w } = fit(base.width * 3, base.height * 3); // render large, then size down below
  const viewport = page.getViewport({ scale: w / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw the PDF.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

export async function logoBlobFromFile(file: File): Promise<LogoBlob> {
  const kind = logoKind(file);
  if (!kind) throw new Error("Please choose a JPEG, PNG or PDF file.");
  if (file.size > LOGO_MAX_BYTES) throw new Error("That file is over 15 MB - please use a smaller one.");

  let source: CanvasImageSource;
  let sw: number, sh: number;
  if (kind === "pdf") {
    const c = await pdfFirstPageCanvas(file);
    source = c; sw = c.width; sh = c.height;
  } else {
    const bmp = await createImageBitmap(file);
    source = bmp; sw = bmp.width; sh = bmp.height;
  }
  const { w, h } = fit(sw, sh);
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not process the image.");
  if (kind === "jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); } // JPEG has no transparency
  ctx.drawImage(source, 0, 0, w, h);
  if (kind === "jpeg") return { blob: await toBlob(out, "image/jpeg", 0.9), ext: "jpg", contentType: "image/jpeg", width: w, height: h };
  return { blob: await toBlob(out, "image/png"), ext: "png", contentType: "image/png", width: w, height: h };
}
