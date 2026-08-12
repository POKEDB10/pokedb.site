process.env.NODE_ENV = 'test';
process.env.ROOTZ_API_KEY = process.env.ROOTZ_API_KEY || 'test-rootz-key';
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../server');

jest.setTimeout(30000);

describe('Concurrency Stress Test Suite', () => {
  test('1. 50 concurrent requests claiming the SAME TinyURL custom alias -> 1 succeeds (200), 49 fail (409)', async () => {
    const alias = `stress-alias-${Date.now()}`;
    const requests = Array.from({ length: 50 }).map((_, i) =>
      request(app)
        .post('/api/shorten')
        .set('Host', 'tinyurl.pokedb.site')
        .set('X-Forwarded-For', `10.0.1.${i + 1}`)
        .send({ url: 'https://example.com/target', customAlias: alias })
    );

    const responses = await Promise.all(requests);
    const successes = responses.filter((r) => r.status === 200);
    const conflicts = responses.filter((r) => r.status === 409);

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(49);
    expect(successes[0].body.code).toBe(alias);
  });

  test('2. 50 concurrent TinyURL random code creations -> 50 unique records, 0 lost', async () => {
    const requests = Array.from({ length: 50 }).map((_, i) =>
      request(app)
        .post('/api/shorten')
        .set('Host', 'tinyurl.pokedb.site')
        .set('X-Forwarded-For', `10.0.2.${i + 1}`)
        .send({ url: `https://example.com/target-${i}` })
    );

    const responses = await Promise.all(requests);
    const codes = new Set();
    responses.forEach((r) => {
      expect(r.status).toBe(200);
      codes.add(r.body.code);
    });

    expect(codes.size).toBe(50);
  });

  test('3. 50 concurrent requests claiming the SAME Drop custom folder ID -> 1 succeeds (200), 49 fail (409)', async () => {
    const customId = `stress-folder-${Date.now()}`;
    const requests = Array.from({ length: 50 }).map((_, i) =>
      request(app)
        .post('/api/drop/create-folder')
        .set('Host', 'drop.pokedb.site')
        .set('X-Forwarded-For', `10.0.3.${i + 1}`)
        .send({ name: 'Stress Folder', customId })
    );

    const responses = await Promise.all(requests);
    const successes = responses.filter((r) => r.status === 200);
    const conflicts = responses.filter((r) => r.status === 409);

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(49);
    expect(successes[0].body.folderCode).toBe(customId);
  });

  test('4. 50 concurrent file uploads attached to the SAME Drop folder -> 50 files attached without loss', async () => {
    const folderRes = await request(app)
      .post('/api/drop/create-folder')
      .set('Host', 'drop.pokedb.site')
      .set('X-Forwarded-For', '10.0.4.1')
      .send({ name: 'Batch Upload Folder' });

    expect(folderRes.status).toBe(200);
    const folderCode = folderRes.body.folderCode;

    const dummyFilePath = path.join(__dirname, 'temp-stress-file.txt');
    fs.writeFileSync(dummyFilePath, 'Stress test file content');

    try {
      const uploadRequests = Array.from({ length: 50 }).map((_, i) =>
        request(app)
          .post('/api/drop/upload')
          .set('Host', 'drop.pokedb.site')
          .set('X-Forwarded-For', `10.0.5.${i + 1}`)
          .field('folderCode', folderCode)
          .field('relativePath', `folder/file-${i}.txt`)
          .attach('file', dummyFilePath)
      );

      const uploadResponses = await Promise.all(uploadRequests);
      uploadResponses.forEach((r) => {
        expect(r.status).toBe(200);
        expect(r.body.success).toBe(true);
      });

      const infoRes = await request(app)
        .get(`/api/drop/info?file_code=${folderCode}`)
        .set('Host', 'drop.pokedb.site');

      expect(infoRes.status).toBe(200);
      const folderRecord = infoRes.body.result[0];
      expect(folderRecord.isFolder).toBe(true);
      expect(folderRecord.files.length).toBe(50);
    } finally {
      if (fs.existsSync(dummyFilePath)) {
        fs.unlinkSync(dummyFilePath);
      }
    }
  });
});
