// src/storage/r2.js
// Cloudflare R2 S3-Compatible Object Store Client (Task P4.1).

const {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

class R2ObjectStore {
  constructor(options = {}) {
    this.bucket = options.bucket || 'pokedb-drops';
    const accountId = options.accountId;
    const accessKeyId = options.accessKeyId;
    const secretAccessKey = options.secretAccessKey;
    const endpoint = options.endpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId: accessKeyId || 'unconfigured',
        secretAccessKey: secretAccessKey || 'unconfigured'
      }
    });
  }

  async createMultipart({ key, contentType = 'application/octet-stream', contentDisposition }) {
    const cmd = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentDisposition: contentDisposition
    });
    const res = await this.client.send(cmd);
    return { uploadId: res.UploadId };
  }

  async presignPart({ key, uploadId, partNumber, expiresInSeconds = 900 }) {
    const cmd = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: Number(partNumber)
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: expiresInSeconds });
    return { url };
  }

  async listParts({ key, uploadId }) {
    const cmd = new ListPartsCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId
    });
    const res = await this.client.send(cmd);
    return {
      parts: (res.Parts || []).map((p) => ({
        PartNumber: p.PartNumber,
        Size: p.Size,
        ETag: p.ETag
      }))
    };
  }

  async complete({ key, uploadId, parts }) {
    const sortedParts = [...parts]
      .sort((a, b) => (a.PartNumber || a.partNumber) - (b.PartNumber || b.partNumber))
      .map((p) => ({
        PartNumber: Number(p.PartNumber || p.partNumber),
        ETag: p.ETag || p.etag
      }));

    const cmd = new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sortedParts
      }
    });
    const res = await this.client.send(cmd);
    return {
      location: res.Location,
      eTag: res.ETag
    };
  }

  async abort({ key, uploadId }) {
    const cmd = new AbortMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId
    });
    await this.client.send(cmd);
  }

  async healthProbe() {
    const cmd = new HeadBucketCommand({
      Bucket: this.bucket
    });
    await this.client.send(cmd);
    return true;
  }

  async head({ key }) {
    const cmd = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key
    });
    const res = await this.client.send(cmd);
    return {
      contentLength: res.ContentLength,
      contentType: res.ContentType,
      eTag: res.ETag,
      metadata: res.Metadata || {}
    };
  }

  async presignGet({ key, expiresInSeconds = 600, filename }) {
    const getParams = {
      Bucket: this.bucket,
      Key: key
    };
    if (filename) {
      getParams.ResponseContentDisposition = `attachment; filename="${encodeURIComponent(filename)}"`;
    }
    const cmd = new GetObjectCommand(getParams);
    const url = await getSignedUrl(this.client, cmd, { expiresIn: expiresInSeconds });
    return { url };
  }

  async delete({ key }) {
    const cmd = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key
    });
    await this.client.send(cmd);
  }

  async deleteMany({ keys }) {
    if (!keys || keys.length === 0) return;
    const cmd = new DeleteObjectsCommand({
      Bucket: this.bucket,
      Delete: {
        Objects: keys.map((k) => ({ Key: k })),
        Quiet: true
      }
    });
    await this.client.send(cmd);
  }
}

function createObjectStore(config = {}) {
  // If R2 credentials are present, instantiate real R2 client; else fallback to in-memory fake
  if (config.r2AccountId && config.r2AccessKeyId && config.r2SecretAccessKey) {
    return new R2ObjectStore({
      bucket: config.r2BucketName,
      accountId: config.r2AccountId,
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey
    });
  }
  // Production must never silently mock storage (Task R9.1 Item 8)
  if (config.isProduction) {
    return null;
  }
  const { FakeObjectStore } = require('./fakeObjectStore');
  return new FakeObjectStore();
}

module.exports = {
  R2ObjectStore,
  createObjectStore
};
