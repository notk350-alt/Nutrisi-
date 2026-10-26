/**
 * NutriBodySim — Express + Vite Full-Stack Application Server
 */

import dotenv from 'dotenv';
dotenv.config();

// Ensure demo authentication is active by default in the web applet container
if (process.env.ENABLE_DEMO_AUTH === undefined) {
  process.env.ENABLE_DEMO_AUTH = 'true';
}

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './backend/routes/api';

import fs from 'fs';
import { db } from './backend/database/store';
import { extractToken } from './backend/auth/authMiddleware';
import { defaultSessionStore } from './backend/auth/sessionStore';
import { canAccessMaterial } from './backend/auth/objectAuth';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Body parsing for JSON payloads and scientific data
  app.use(express.json({ limit: '30mb' }));
  app.use(express.urlencoded({ extended: true, limit: '30mb' }));

  // Protected storage for uploaded materials (BOLA / Path Traversal protected)
  const storageDir = path.resolve(process.cwd(), 'storage', 'materials');
  app.get('/storage/materials/:filename', (req, res) => {
    const rawFilename = req.params.filename;
    // 1. Path traversal defense
    if (rawFilename.includes('..') || rawFilename.includes('/') || rawFilename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    const safePath = path.resolve(storageDir, rawFilename);
    if (!safePath.startsWith(storageDir)) {
      return res.status(403).json({ error: 'Access denied: Path traversal detected' });
    }
    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // 2. Resolve material record
    const state = db.getState();
    const material = state.materials.find(m => m.file_path === rawFilename);

    // 3. Disallow serving unmapped storage files (orphan or unlinked files)
    if (!material) {
      return res.status(404).json({ error: 'Material record not found for requested file' });
    }

    // 4. Enforce object authorization on material
    const token = extractToken(req);
    const validation = token ? defaultSessionStore.validateSession(token) : null;
    const user = validation?.valid && validation.userId ? state.users.find(u => u.id === validation.userId) : undefined;

    if (user) {
      const auth = canAccessMaterial(user, material, 'READ');
      if (!auth.allowed) {
        db.logAudit(
          user.id,
          'VERIFY',
          'SECURITY_BOLA',
          material.id,
          `BOLA Denied: ${user.name} denied file download for "${material.title}" (${rawFilename})`
        );
        return res.status(403).json({
          error: 'Access denied: You do not have permission to access this file',
          code: 'OBJECT_ACCESS_DENIED'
        });
      }
    } else {
      // Unauthenticated access allowed ONLY if material is linked exclusively to public projects
      const isPublic = material.project_ids && material.project_ids.length > 0 && material.project_ids.every(pId => {
        const p = state.projects.find(proj => proj.id === pId);
        return p && p.is_public;
      });
      if (!isPublic) {
        return res.status(401).json({
          error: 'Authentication required to access this file',
          code: 'AUTH_REQUIRED'
        });
      }
    }

    res.sendFile(safePath);
  });

  // Mount Scientific API router FIRST
  app.use('/api', apiRouter);

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'NutriBodySim Scientific Computation Engine',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  });

  // Vite middleware in development vs static SPA in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[NutriBodySim Engine v1.0] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Fatal error during NutriBodySim server startup:', err);
  process.exit(1);
});
