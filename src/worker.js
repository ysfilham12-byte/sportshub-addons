import { initWasm, Resvg } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import font from '../assets/AtkinsonHyperlegibleNext.ttf';
import addon from './index.js';

let init;

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || !/^\/artwork\/(?:wide\/)?sh_[\w-]+\.png$/.test(url.pathname)) {
      return addon.fetch(request, env, {
        artworkExtension: 'png', metadataCache: globalThis.caches?.default,
        waitUntil: context?.waitUntil.bind(context)
      });
    }

    url.pathname = url.pathname.replace(/\.png$/, '.svg');
    const artwork = await addon.fetch(new Request(url), env);
    if (!artwork.ok) return artwork;

    init ??= initWasm(wasm);
    await init;
    const svg = await artwork.text();
    const renderer = new Resvg(svg.replace('Arial, sans-serif', 'Atkinson Hyperlegible Next'), {
      font: {
        fontBuffers: [new Uint8Array(font)],
        loadSystemFonts: false,
        defaultFontFamily: 'Atkinson Hyperlegible Next'
      }
    });
    const rendered = renderer.render();
    try {
      return new Response(rendered.asPng().slice(), {
        headers: {
          'content-type': 'image/png',
          'cache-control': artwork.headers.get('cache-control')
        }
      });
    } finally {
      rendered.free();
      renderer.free();
    }
  }
};
