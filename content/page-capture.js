// Only reads live DOM state here. No resource downloads or archive assembly.
import * as helper from "single-file-core/core/helper.js";
import { captureOptions } from "../shared/capture-options.js";

if (!globalThis.__karakeepCapture) {
  let session;

  function prepare(id) {
    if (session) throw new Error("A capture is already running");
    // Our own overlay must never appear in screenshots or archived HTML.
    document.getElementById("karakeep-quick-archive-list-picker-host")?.remove();
    session = { id };
    const url = location.href;
    const title = document.title || url;
    const description = document.querySelector('meta[name="description"], meta[property="og:description"]')?.content || "";
    const text = (document.body?.innerText || "").slice(0, 500_000);
    const candidates = [
      ...document.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"], meta[property="twitter:image"]')
    ].map((meta) => meta.content);
    const images = [...document.images].filter((img) => img.naturalWidth >= 150 && img.naturalHeight >= 100);
    images.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
    candidates.push(...images.slice(0, 5).map((img) => img.currentSrc || img.src));
    const bannerUrls = [...new Set(candidates.filter(Boolean).map((src) => {
      try { return new URL(src, document.baseURI).href; } catch { return null; }
    }).filter(Boolean))].slice(0, 5);
    const fallbackHtml = text.trim()
      ? `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"></head><body><h1>${escape(title)}</h1><pre>${escape(text)}</pre></body></html>`
      : null;
    const challenge = /browser has failed some security checks|verify you are human|checking your browser|just a moment/i.test(`${title}\n${text.slice(0, 3000)}`);
    return { url, title, bannerUrls, fallbackHtml, challenge };
  }

  function freeze(id) {
    if (session?.id !== id) throw new Error("Invalid capture session");
    let data;
    try {
      data = helper.preProcessDoc(document, window, captureOptions);
      const content = helper.serialize(document);
      // DOM nodes are needed only to restore the live page, never for assembly.
      const { markedElements, invalidElements, ...state } = data;
      return { url: location.href, baseURI: document.baseURI, content, state };
    } finally {
      if (data) helper.postProcessDoc(document, data.markedElements, data.invalidElements);
    }
  }

  function escape(value) {
    return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  globalThis.__karakeepCapture = { prepare, freeze, end: (id) => {
    if (session?.id === id) session = null;
  } };
}
