import { buildDeckPreviewHtml } from "./render-deck";
import type { SlideDeck } from "./slides";

export async function captureDeckSlide(
  deck: SlideDeck,
  slideIndex: number,
  imageSources: Record<string, string | undefined>,
  width = 1280
): Promise<string> {
  const height = Math.round(width * deck.size.height / deck.size.width);
  const iframe = document.createElement("iframe");
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;border:0;visibility:hidden`;
  iframe.srcdoc = buildDeckPreviewHtml(deck, slideIndex, { imageSources });
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve, reject) => {
      iframe.onload = () => resolve();
      iframe.onerror = () => reject(new Error("Could not render the slide."));
    });
    const doc = iframe.contentDocument;
    const slide = doc?.getElementById("mach-slide");
    if (!doc || !slide) throw new Error("The rendered slide is unavailable.");
    await Promise.all([...doc.images].map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.onerror = () => resolve();
    })));
    await doc.fonts?.ready;
    const serialized = new XMLSerializer().serializeToString(slide);
    const styles = [...doc.querySelectorAll("style")].map((style) => style.textContent ?? "").join("\n").replace(/]]>/g, "]] >");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px"><style><![CDATA[${styles}]]></style>${serialized}</div></foreignObject></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas rendering is unavailable.");
      context.drawImage(image, 0, 0, width, height);
      return canvas.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(url);
    }
  } finally {
    iframe.remove();
  }
}
