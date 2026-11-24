// src/tools/qr/router.js
// QR code generator API and static UI router (Task P3.5).

const express = require('express');
const path = require('node:path');
const QRCode = require('qrcode');

function createQrRouter(options = {}) {
  const router = express.Router();
  const limiters = options.limiters || {};
  const qrLimiter = limiters.qrLimiter || ((req, res, next) => next());

  const handleQrGeneration = async (req, res) => {
    try {
      if (req.method === 'GET') {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
      const text = req.body?.text || req.query?.text || 'https://pokedb.site';
      const format = req.body?.format || req.query?.format || 'json';
      const dark = req.body?.dark || req.query?.dark || '#000000';
      const light = req.body?.light || req.query?.light || '#ffffff';

      const qrOptions = {
        margin: 1,
        errorCorrectionLevel: 'H',
        color: {
          dark: dark,
          light: light === 'transparent' ? '#ffffff00' : light
        }
      };

      if (format === 'svg') {
        const svg = await QRCode.toString(text, { ...qrOptions, type: 'svg' });
        res.setHeader('Content-Type', 'image/svg+xml');
        if (req.query.download === '1') {
          res.setHeader('Content-Disposition', 'attachment; filename="qrcode.svg"');
        }
        return res.send(svg);
      }

      const dataUrl = await QRCode.toDataURL(text, { ...qrOptions, width: 512 });

      if (format === 'png') {
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        const imgBuffer = Buffer.from(base64Data, 'base64');
        res.setHeader('Content-Type', 'image/png');
        if (req.query.download === '1') {
          res.setHeader('Content-Disposition', 'attachment; filename="qrcode.png"');
        }
        return res.send(imgBuffer);
      }

      return res.json({ text, dataUrl });
    } catch (err) {
      console.error('Error generating QR:', err);
      return res.status(400).json({ error: 'Failed to generate QR code' });
    }
  };

  router.get('/api/qr', qrLimiter, handleQrGeneration);
  router.post('/api/qr', qrLimiter, handleQrGeneration);

  return router;
}

module.exports = {
  createQrRouter
};
