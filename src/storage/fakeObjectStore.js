// src/storage/fakeObjectStore.js
// In-memory fake object store for tests and development without live Cloudflare R2 credentials (Task P4.1).

const crypto = require('node:crypto');

class FakeObjectStore {
  constructor() {
    this.objects = new Map(); // key -> { key, size, contentType, contentDisposition, eTag, data, createdAt }
    this.multiparts = new Map(); // uploadId -> { key, contentType, contentDisposition, parts: Map<partNumber, { partNumber, size, etag }>, createdAt }
  }

  async createMultipart({ key, contentType = 'application/octet-stream', contentDisposition }) {
    const uploadId = 'fake-mp-' + crypto.randomBytes(12).toString('hex');
    this.multiparts.set(uploadId, {
      key,
      contentType,
      contentDisposition,
      parts: new Map(),
      createdAt: Date.now()
    });
    return { uploadId };
  }

  async presignPart({ key, uploadId, partNumber, expiresInSeconds = 900 }) {
    const mp = this.multiparts.get(uploadId);
    if (!mp) throw new Error(`NoSuchUpload: UploadId ${uploadId} not found`);
    return {
      url: `https://fake-r2.local/${key}?uploadId=${uploadId}&partNumber=${partNumber}&expires=${Date.now() + expiresInSeconds * 1000}`
    };
  }

  async recordPartUpload(uploadId, partNumber, size, etag = null) {
    const mp = this.multiparts.get(uploadId);
    if (!mp) throw new Error(`NoSuchUpload: UploadId ${uploadId} not found`);
    const partEtag = etag || `"${crypto.randomBytes(16).toString('hex')}"`;
    mp.parts.set(Number(partNumber), {
      PartNumber: Number(partNumber),
      Size: Number(size),
      ETag: partEtag
    });
    return { PartNumber: Number(partNumber), ETag: partEtag };
  }

  async listParts({ key, uploadId }) {
    const mp = this.multiparts.get(uploadId);
    if (!mp) throw new Error(`NoSuchUpload: UploadId ${uploadId} not found`);
    const partsArray = Array.from(mp.parts.values()).sort((a, b) => a.PartNumber - b.PartNumber);
    return { parts: partsArray };
  }

  async complete({ key, uploadId, parts }) {
    const mp = this.multiparts.get(uploadId);
    if (!mp) throw new Error(`NoSuchUpload: UploadId ${uploadId} not found`);

    let totalSize = 0;
    const sortedParts = [...parts].sort((a, b) => (a.PartNumber || a.partNumber) - (b.PartNumber || b.partNumber));
    for (const p of sortedParts) {
      const pNum = Number(p.PartNumber || p.partNumber);
      const recorded = mp.parts.get(pNum);
      totalSize += recorded ? recorded.Size : 5 * 1024 * 1024; // fallback default 5MB if unrecorded
    }

    const eTag = `"${crypto.randomBytes(16).toString('hex')}-${sortedParts.length}"`;
    this.objects.set(key, {
      key,
      size: totalSize,
      contentType: mp.contentType,
      contentDisposition: mp.contentDisposition,
      eTag,
      createdAt: Date.now()
    });

    this.multiparts.delete(uploadId);
    return {
      location: `https://fake-r2.local/${key}`,
      eTag
    };
  }

  async abort({ key, uploadId }) {
    this.multiparts.delete(uploadId);
  }

  async healthProbe() {
    return true;
  }

  async head({ key }) {
    const obj = this.objects.get(key);
    if (!obj) {
      const err = new Error('NotFound');
      err.name = 'NotFound';
      err.$metadata = { httpStatusCode: 404 };
      throw err;
    }
    return {
      contentLength: obj.size,
      contentType: obj.contentType,
      eTag: obj.eTag,
      metadata: {}
    };
  }

  async presignGet({ key, expiresInSeconds = 600, filename }) {
    const obj = this.objects.get(key);
    if (!obj) {
      const err = new Error('NotFound');
      err.name = 'NotFound';
      err.$metadata = { httpStatusCode: 404 };
      throw err;
    }
    const fnParam = filename ? `&response-content-disposition=attachment%3B%20filename%3D%22${encodeURIComponent(filename)}%22` : '';
    return {
      url: `https://fake-r2.local/${key}?download=1&expires=${Date.now() + expiresInSeconds * 1000}${fnParam}`
    };
  }

  async delete({ key }) {
    this.objects.delete(key);
  }

  async deleteMany({ keys }) {
    for (const k of keys) {
      this.objects.delete(k);
    }
  }

  // Test helper: directly store a mock object
  putMockObject(key, { size, contentType = 'application/octet-stream', contentDisposition }) {
    this.objects.set(key, {
      key,
      size,
      contentType,
      contentDisposition,
      eTag: `"${crypto.randomBytes(16).toString('hex')}"`,
      createdAt: Date.now()
    });
  }
}

module.exports = {
  FakeObjectStore
};
