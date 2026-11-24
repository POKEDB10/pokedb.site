// tests/r2-offline.test.js
// Offline Unit Test Suite for Cloudflare R2 S3-Compatible Storage (Task R9.2 Item 10)
// Validates SigV4 presigned URL vectors, multipart rules, error handling, and production fail-closed semantics.

const { R2ObjectStore, createObjectStore } = require('../src/storage/r2');
const { FakeObjectStore } = require('../src/storage/fakeObjectStore');

describe('Offline R2 Storage Unit Suite (src/storage/r2.js)', () => {
  const dummyConfig = {
    bucket: 'test-bucket',
    accountId: '0123456789abcdef0123456789abcdef',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com'
  };

  let store;

  beforeEach(() => {
    store = new R2ObjectStore(dummyConfig);
  });

  describe('1. Construction and Configuration', () => {
    test('initializes with default bucket if not provided', () => {
      const defaultStore = new R2ObjectStore({ accountId: 'dummy' });
      expect(defaultStore.bucket).toBe('pokedb-drops');
    });

    test('initializes with custom bucket and custom endpoint', () => {
      expect(store.bucket).toBe('test-bucket');
      expect(store.client).toBeDefined();
    });
  });

  describe('2. SigV4 Presigned URL Generation (Deterministic Offline Cryptography)', () => {
    test('presignGet generates valid AWS SigV4 GET URL with HMAC-SHA256 signature', async () => {
      const { url } = await store.presignGet({
        key: 'drop-abc123/payload.bin',
        expiresInSeconds: 600
      });

      expect(typeof url).toBe('string');
      const parsed = new URL(url);
      expect(parsed.protocol).toBe('https:');
      expect(parsed.hostname).toBe('test-bucket.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com');
      expect(parsed.pathname).toBe('/drop-abc123/payload.bin');

      // Verify SigV4 Query Parameters
      const sp = parsed.searchParams;
      expect(sp.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(sp.get('X-Amz-Credential')).toContain('AKIAIOSFODNN7EXAMPLE');
      expect(sp.get('X-Amz-Date')).toMatch(/^\d{8}T\d{6}Z$/);
      expect(sp.get('X-Amz-Expires')).toBe('600');
      expect(sp.get('X-Amz-SignedHeaders')).toBe('host');
      expect(sp.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/); // 64-char hex SHA256 HMAC
    });

    test('presignGet with filename sets attachment response-content-disposition', async () => {
      const { url } = await store.presignGet({
        key: 'drop-abc123/payload.bin',
        expiresInSeconds: 300,
        filename: 'report 2026.pdf'
      });

      const parsed = new URL(url);
      const sp = parsed.searchParams;
      expect(sp.get('response-content-disposition')).toBe('attachment; filename="report%202026.pdf"');
      expect(sp.get('X-Amz-Expires')).toBe('300');
      expect(sp.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    });

    test('cross-checks presigned GET URL directly against @aws-sdk/s3-request-presigner', async () => {
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      const { GetObjectCommand } = require('@aws-sdk/client-s3');

      const expectedUrl = await getSignedUrl(
        store.client,
        new GetObjectCommand({
          Bucket: store.bucket,
          Key: 'drop-abc123/payload.bin'
        }),
        { expiresIn: 600 }
      );

      const { url: actualUrl } = await store.presignGet({
        key: 'drop-abc123/payload.bin',
        expiresInSeconds: 600
      });

      const parsedExpected = new URL(expectedUrl);
      const parsedActual = new URL(actualUrl);

      expect(parsedActual.origin).toBe(parsedExpected.origin);
      expect(parsedActual.pathname).toBe(parsedExpected.pathname);
      expect(parsedActual.searchParams.get('X-Amz-Algorithm')).toBe(parsedExpected.searchParams.get('X-Amz-Algorithm'));
      expect(parsedActual.searchParams.get('X-Amz-Credential')).toBe(parsedExpected.searchParams.get('X-Amz-Credential'));
      expect(parsedActual.searchParams.get('X-Amz-SignedHeaders')).toBe(parsedExpected.searchParams.get('X-Amz-SignedHeaders'));
      expect(parsedActual.searchParams.get('X-Amz-Expires')).toBe('600');
    });

    test('presignPart generates valid SigV4 upload part URL with uploadId and partNumber', async () => {
      const { url } = await store.presignPart({
        key: 'drop-abc123/large-file.iso',
        uploadId: 'test-upload-id-999',
        partNumber: 3,
        expiresInSeconds: 900
      });

      const parsed = new URL(url);
      const sp = parsed.searchParams;
      expect(sp.get('partNumber')).toBe('3');
      expect(sp.get('uploadId')).toBe('test-upload-id-999');
      expect(sp.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(sp.get('X-Amz-Expires')).toBe('900');
      expect(sp.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('3. Multipart Upload Commands and Sorting Rules', () => {
    test('createMultipart dispatches CreateMultipartUploadCommand and returns uploadId', async () => {
      const mockSend = jest.spyOn(store.client, 'send').mockResolvedValueOnce({
        UploadId: 'mp-upload-xyz789'
      });

      const res = await store.createMultipart({
        key: 'files/test.zip',
        contentType: 'application/zip',
        contentDisposition: 'inline'
      });

      expect(res).toEqual({ uploadId: 'mp-upload-xyz789' });
      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Bucket).toBe('test-bucket');
      expect(cmd.input.Key).toBe('files/test.zip');
      expect(cmd.input.ContentType).toBe('application/zip');
      expect(cmd.input.ContentDisposition).toBe('inline');
    });

    test('complete sorts parts numerically by PartNumber before sending', async () => {
      const mockSend = jest.spyOn(store.client, 'send').mockResolvedValueOnce({
        Location: 'https://test-bucket/files/test.zip',
        ETag: '"final-composite-etag"'
      });

      // Pass out-of-order parts with mixed key casing (partNumber vs PartNumber)
      const unsortedParts = [
        { partNumber: 5, etag: '"etag-5"' },
        { PartNumber: 1, ETag: '"etag-1"' },
        { partNumber: 3, ETag: '"etag-3"' },
        { PartNumber: 2, etag: '"etag-2"' }
      ];

      const res = await store.complete({
        key: 'files/test.zip',
        uploadId: 'mp-upload-xyz789',
        parts: unsortedParts
      });

      expect(res).toEqual({
        location: 'https://test-bucket/files/test.zip',
        eTag: '"final-composite-etag"'
      });

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.MultipartUpload.Parts).toEqual([
        { PartNumber: 1, ETag: '"etag-1"' },
        { PartNumber: 2, ETag: '"etag-2"' },
        { PartNumber: 3, ETag: '"etag-3"' },
        { PartNumber: 5, ETag: '"etag-5"' }
      ]);
    });

    test('listParts retrieves and formats uploaded parts', async () => {
      jest.spyOn(store.client, 'send').mockResolvedValueOnce({
        Parts: [
          { PartNumber: 1, Size: 5242880, ETag: '"etag-1"' },
          { PartNumber: 2, Size: 3145728, ETag: '"etag-2"' }
        ]
      });

      const res = await store.listParts({
        key: 'files/test.zip',
        uploadId: 'mp-upload-xyz789'
      });

      expect(res.parts).toEqual([
        { PartNumber: 1, Size: 5242880, ETag: '"etag-1"' },
        { PartNumber: 2, Size: 3145728, ETag: '"etag-2"' }
      ]);
    });

    test('abort dispatches AbortMultipartUploadCommand', async () => {
      const mockSend = jest.spyOn(store.client, 'send').mockResolvedValueOnce({});

      await store.abort({
        key: 'files/test.zip',
        uploadId: 'mp-upload-xyz789'
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Bucket).toBe('test-bucket');
      expect(cmd.input.Key).toBe('files/test.zip');
      expect(cmd.input.UploadId).toBe('mp-upload-xyz789');
    });
  });

  describe('4. Object Metadata and Deletion Commands', () => {
    test('head returns mapped contentLength, contentType, eTag, and metadata', async () => {
      jest.spyOn(store.client, 'send').mockResolvedValueOnce({
        ContentLength: 1048576,
        ContentType: 'application/pdf',
        ETag: '"pdf-etag-123"',
        Metadata: { owner: 'user-42' }
      });

      const res = await store.head({ key: 'files/doc.pdf' });
      expect(res).toEqual({
        contentLength: 1048576,
        contentType: 'application/pdf',
        eTag: '"pdf-etag-123"',
        metadata: { owner: 'user-42' }
      });
    });

    test('delete sends DeleteObjectCommand', async () => {
      const mockSend = jest.spyOn(store.client, 'send').mockResolvedValueOnce({});
      await store.delete({ key: 'files/deleted.txt' });
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0].input.Key).toBe('files/deleted.txt');
    });

    test('deleteMany formats key list and sets Quiet: true', async () => {
      const mockSend = jest.spyOn(store.client, 'send').mockResolvedValueOnce({});
      await store.deleteMany({ keys: ['k1', 'k2', 'k3'] });
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0].input.Delete).toEqual({
        Objects: [{ Key: 'k1' }, { Key: 'k2' }, { Key: 'k3' }],
        Quiet: true
      });
    });

    test('deleteMany no-ops cleanly when keys array is empty or undefined', async () => {
      const mockSend = jest.spyOn(store.client, 'send');
      await store.deleteMany({ keys: [] });
      await store.deleteMany({});
      expect(mockSend).not.toHaveBeenCalled();
    });

    test('healthProbe returns true on successful HeadBucket', async () => {
      jest.spyOn(store.client, 'send').mockResolvedValueOnce({});
      const healthy = await store.healthProbe();
      expect(healthy).toBe(true);
    });
  });

  describe('5. Factory createObjectStore Semantics (Fail-Closed Production Rules)', () => {
    test('returns R2ObjectStore instance when all credentials are provided', () => {
      const instance = createObjectStore({
        r2AccountId: 'acc123',
        r2AccessKeyId: 'key123',
        r2SecretAccessKey: 'secret123',
        r2BucketName: 'prod-bucket'
      });
      expect(instance).toBeInstanceOf(R2ObjectStore);
      expect(instance.bucket).toBe('prod-bucket');
    });

    test('fails closed returning null in production when credentials are unset (Task R9.1 Item 8)', () => {
      const instance = createObjectStore({
        isProduction: true
      });
      expect(instance).toBeNull();
    });

    test('falls back to FakeObjectStore in dev/test when credentials are unset', () => {
      const instance = createObjectStore({
        isProduction: false
      });
      expect(instance).toBeInstanceOf(FakeObjectStore);
    });
  });
});
