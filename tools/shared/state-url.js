// tools/shared/state-url.js
// Client-side URL state encoder/decoder via CompressionStream + base64url (Task P7.5).
// Allows sharing tool configuration/input in URL fragment without sending data to the server.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StateUrl = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  async function encodeState(obj) {
    try {
      const jsonStr = JSON.stringify(obj);
      if (typeof CompressionStream !== 'undefined') {
        const blob = new Blob([jsonStr], { type: 'text/plain' });
        const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
        const response = new Response(stream);
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      } else {
        return encodeURIComponent(jsonStr);
      }
    } catch (e) {
      console.warn('[StateUrl] encode error:', e);
      return '';
    }
  }

  async function decodeState(hashString) {
    if (!hashString) return null;
    let token = hashString;
    if (token.startsWith('#state=')) token = token.slice(7);
    if (token.startsWith('#')) token = token.slice(1);
    if (!token) return null;

    try {
      if (typeof DecompressionStream !== 'undefined' && /^[A-Za-z0-9_-]+$/.test(token)) {
        let base64 = token.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4 !== 0) base64 += '=';
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes]);
        const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
        const response = new Response(stream);
        const text = await response.text();
        return JSON.parse(text);
      } else {
        return JSON.parse(decodeURIComponent(token));
      }
    } catch (e) {
      console.warn('[StateUrl] decode error:', e);
      return null;
    }
  }

  return {
    encodeState,
    decodeState
  };
});
