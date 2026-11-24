// tools/shared/crypto-web.js
// Client-side WebCrypto AES-256-GCM chunk encryption & decryption (Task P4.8, P7.6).
// 12-byte IV: 4 random bytes + 8-byte counter.
// AAD: 4-byte chunk index (big-endian) + 1-byte isFinal flag.
// Key resides strictly in browser URL fragment (#k=) and is never transmitted to the server.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CryptoWeb = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function bufToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBuf(base64url) {
    let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function makeIv(prefix4Bytes, counterBigInt) {
    const iv = new Uint8Array(12);
    iv.set(prefix4Bytes, 0);
    const view = new DataView(iv.buffer);
    view.setBigUint64(4, BigInt(counterBigInt), false); // big-endian
    return iv;
  }

  function makeAad(chunkIndex, isFinal) {
    const aad = new Uint8Array(5);
    const view = new DataView(aad.buffer);
    view.setUint32(0, chunkIndex, false); // 4 bytes chunk index
    aad[4] = isFinal ? 1 : 0;             // 1 byte final flag
    return aad;
  }

  async function generateKey() {
    const cryptoKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    const raw = await crypto.subtle.exportKey('raw', cryptoKey);
    const keyString = bufToBase64Url(raw);
    return { cryptoKey, keyString };
  }

  async function importKeyFromString(keyString) {
    const raw = base64UrlToBuf(keyString);
    return await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptText(text) {
    const { cryptoKey, keyString } = await generateKey();
    const encoder = new TextEncoder();
    const plainBytes = encoder.encode(text);

    const prefix = new Uint8Array(4);
    crypto.getRandomValues(prefix);
    const iv = makeIv(prefix, 0n);
    const aad = makeAad(0, true);

    const cipherBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv, additionalData: aad },
      cryptoKey,
      plainBytes
    );

    const fullPayload = new Uint8Array(iv.length + cipherBuffer.byteLength);
    fullPayload.set(iv, 0);
    fullPayload.set(new Uint8Array(cipherBuffer), iv.length);

    return {
      ciphertext: bufToBase64Url(fullPayload),
      key: keyString
    };
  }

  async function decryptText(ciphertextBase64Url, keyString) {
    const cryptoKey = await importKeyFromString(keyString);
    const fullPayload = new Uint8Array(base64UrlToBuf(ciphertextBase64Url));

    if (fullPayload.length < 12 + 16) {
      throw new Error('Ciphertext payload is too short or malformed');
    }

    const iv = fullPayload.slice(0, 12);
    const cipherBytes = fullPayload.slice(12);
    const aad = makeAad(0, true);

    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv, additionalData: aad },
      cryptoKey,
      cipherBytes
    );

    return new TextDecoder().decode(plainBuffer);
  }

  return {
    generateKey,
    importKeyFromString,
    encryptText,
    decryptText,
    bufToBase64Url,
    base64UrlToBuf
  };
});
