process.env.NODE_ENV = 'test';
process.env.ROOTZ_API_KEY = process.env.ROOTZ_API_KEY || 'test-rootz-key';
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'test-admin-token';
const request = require('supertest');
const path = require('path');
const fs = require('fs');
const app = require('../server');

describe('Adversarial Security Regression Suite', () => {

  describe('1. SSRF & Path Traversal', () => {
    test('1a. Reject SSRF via private IPv4, IPv6, loopback, and localhost in remote URL fetch', async () => {
      const dangerousUrls = [
        'http://127.0.0.1/admin',
        'http://localhost:8080/secret',
        'http://169.254.169.254/latest/meta-data/',
        'http://[::1]/internal',
        'http://[::ffff:127.0.0.1]/status'
      ];

      for (const url of dangerousUrls) {
        const res = await request(app)
          .post('/api/drop/remote-upload')
          .set('Host', 'drop.pokedb.site')
          .send({ url });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid or unsafe remote URL/i);
      }
    });

    test('1b. Reject path traversal attempt via localPath in drop file streaming', async () => {
      const traveralRes = await request(app)
        .get('/v/../../etc/passwd')
        .set('Host', 'drop.pokedb.site');
      expect(traveralRes.status).toBe(404);
    });
  });

  describe('2. IDOR & Enumeration', () => {
    test('2a. Drop deletion requires valid deletionToken and fails with 403 on invalid token', async () => {
      const queryTokenRes = await request(app)
        .delete('/api/drop/delete?fileId=nonexistent&token=invalid-token')
        .set('Host', 'drop.pokedb.site');
      expect(queryTokenRes.status).toBe(400);
      expect(queryTokenRes.body.error).toBe('query_tokens_forbidden');

      const res = await request(app)
        .delete('/api/drop/delete?fileId=nonexistent')
        .set('Host', 'drop.pokedb.site')
        .set('X-Delete-Token', 'invalid-token');
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Deletion requires an active upload record/i);
    });

    test('2b. Admin endpoints reject requests without valid timing-safe ADMIN_TOKEN', async () => {
      const noTokenRes = await request(app)
        .get('/api/drop/list')
        .set('Host', 'drop.pokedb.site');
      expect(noTokenRes.status).toBe(403);

      const queryTokenRes = await request(app)
        .get('/api/drop/list?token=wrong-token')
        .set('Host', 'drop.pokedb.site');
      expect(queryTokenRes.status).toBe(400);
      expect(queryTokenRes.body.error).toBe('query_tokens_forbidden');

      const invalidTokenRes = await request(app)
        .get('/api/drop/list')
        .set('Host', 'drop.pokedb.site')
        .set('X-Admin-Token', 'wrong-token');
      expect(invalidTokenRes.status).toBe(403);
    });
  });

  describe('3. Rate-Limit Bypass & Header Protection', () => {
    test('3a. Reject API requests to unauthorized hosts despite spoofed Host header routing', async () => {
      const res = await request(app)
        .post('/api/shorten')
        .set('Host', 'malicious.attacker.com')
        .send({ url: 'https://example.com' });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/API endpoint not available on this subdomain/i);
    });
  });

  describe('4. Upload-Path DoS & Validation', () => {
    test('4a. Reject multipart upload without file payload', async () => {
      const res = await request(app)
        .post('/api/drop/upload')
        .set('Host', 'drop.pokedb.site');
      expect(res.status).toBe(400);
    });

    test('4b. Reject remote upload request exceeding 1GB without password header', async () => {
      const res = await request(app)
        .post('/api/drop/remote-upload')
        .set('Host', 'drop.pokedb.site')
        .send({ url: 'https://example.com/bigfile.iso', fileSize: 2000000000 });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid or missing owner password/i);
    });
  });

  describe('5. XSS Defense', () => {
    test('5a. Escape HTML payloads in TinyURL custom alias responses', async () => {
      const xssAlias = 'test-xss-<script>alert(1)</script>';
      const res = await request(app)
        .post('/api/shorten')
        .set('Host', 'tinyurl.pokedb.site')
        .send({ url: 'https://example.com', customAlias: xssAlias });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Custom alias must be alphanumeric/i);
    });

    test('5b. Safely handle XSS strings in QR text payloads', async () => {
      const xssText = '<script>alert("xss")</script>';
      const res = await request(app)
        .get(`/api/qr?text=${encodeURIComponent(xssText)}&format=svg`)
        .set('Host', 'qr.pokedb.site');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/svg\+xml/i);
    });
  });
});
