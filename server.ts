/**
 * NutriBodySim — Express + Vite Full-Stack Application Server
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'path';
import type { Server } from 'http';
import { createServer as createViteServer } from 'vite';

import fs from 'fs';
import {
  closeRuntimeDatabase,
  initializeRuntimeDatabase
} from './backend/database/runtime';
import { extractToken } from './backend/auth/authMiddleware';
import { canAccessMaterialWithRepositories } from './backend/auth/objectAuth';

async function startServer() {
  const runtime = await initializeRuntimeDatabase();
  console.log(`[NutriBodySim] Runtime provider: ${runtime.provider}`);
  if (!runtime.health.ok) {
    throw new Error(runtime.health.reason || 'Runtime database health check failed.');
  }
  const { apiRouter } = await import('./backend/routes/api');
  const app = express();
  const configuredPort = process.env.PORT?.trim();
  const port = configuredPort ? Number(configuredPort) : 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  // Body parsing for JSON payloads and scientific data
  app.use(express.json({ limit: '30mb' }));
  app.use(express.urlencoded({ extended: true, limit: '30mb' }));

  // Protected storage for uploaded materials (BOLA / Path Traversal protected)
  const storageDir = path.resolve(process.cwd(), 'storage', 'materials');
    app.get('/storage/materials/:filename', async (req, res, next) => {
      try {
        const rawFilename = req.params.filename;
        if (rawFilename.includes('..') || rawFilename.includes('/') || rawFilename.includes('\\')) {
          return res.status(400).json({ error: 'Invalid file path' });
        }

        const safePath = path.resolve(storageDir, rawFilename);
        if (path.dirname(safePath) !== storageDir) {
          return res.status(403).json({ error: 'Access denied: Path traversal detected' });
        }
        try {
          await fs.promises.access(safePath, fs.constants.R_OK);
        } catch {
          return res.status(404).json({ error: 'File not found' });
        }

        const repositories = runtime.repositories;
        const material = await repositories.materials.findByFilePath(rawFilename);
        if (!material) {
          return res.status(404).json({ error: 'Material record not found for requested file' });
        }

        const token = extractToken(req);
        const validation = token ? await repositories.sessions.validateSession(token) : null;
        const user = validation?.valid && validation.userId
          ? await repositories.users.findById(validation.userId)
          : null;

        if (user && (
          (user.account_status && user.account_status !== 'ACTIVE') ||
          validation?.tokenVersion !== (user.token_version ?? 1)
        )) {
          return res.status(403).json({
            error: 'Access denied: Session is inactive or invalidated',
            code: 'FORBIDDEN_ACCOUNT_STATUS'
          });
        }

        if (user) {
          const authorization = await canAccessMaterialWithRepositories(repositories, user, material, 'READ');
          if (!authorization.allowed) {
            await repositories.auditLogs.appendLog({
              user_id: user.id,
              user_name: user.name,
              action: 'VERIFY',
              entity_type: 'SECURITY_BOLA',
              entity_id: material.id,
              details: `BOLA denied file download for material "${material.title}" (${rawFilename}).`
            });
            return res.status(403).json({
              error: 'Access denied: You do not have permission to access this file',
              code: 'OBJECT_ACCESS_DENIED'
            });
          }
        } else {
          const projectIds = material.project_ids ?? [];
          const projects = await Promise.all(projectIds.map(projectId => repositories.projects.findById(projectId)));
          const isPublic = projectIds.length > 0 && projects.every(project => project?.is_public === true);
          if (!isPublic) {
            return res.status(401).json({
              error: 'Authentication required to access this file',
              code: 'AUTH_REQUIRED'
            });
          }
        }

        return res.sendFile(safePath);
      } catch (error) {
        return next(error);
      }
    });

  // Mount Scientific API router FIRST
  app.use('/api', apiRouter);

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    const candidate = error instanceof Error
      ? error as Error & { statusCode?: number; code?: string; cause?: { code?: string } }
      : undefined;
    const databaseCode = candidate?.code ?? candidate?.cause?.code;
    const databaseUnavailable = Boolean(
      databaseCode && (/^08/.test(databaseCode) || ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(databaseCode))
    );
    const statusCode = databaseUnavailable
      ? 503
      : candidate?.statusCode && candidate.statusCode >= 400 && candidate.statusCode < 600
        ? candidate.statusCode
        : 500;
    console.error(`[NutriBodySim] Request failed (${databaseUnavailable ? 'database unavailable' : `HTTP ${statusCode}`}).`);
    return res.status(statusCode).json({
      error: databaseUnavailable ? 'Database service unavailable.' : statusCode === 500 ? 'Internal server error.' : candidate?.message,
      code: databaseUnavailable ? 'DATABASE_UNAVAILABLE' : statusCode === 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'
    });
  });

  app.get('/health', async (_req, res) => {
    const health = await runtime.healthCheck();
    return res.status(health.ok ? 200 : 503).json({
      status: health.ok ? 'ok' : 'degraded',
      provider: health.provider,
      database: health.databaseName ?? null,
      schema: health.schemaName ?? null,
      branch_id: health.branchId ?? null,
      tls_verified: health.tlsVerified ?? null
    });
  });

  // Vite middleware in development vs static SPA in production
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  if (process.env.NODE_ENV !== 'production') {
    vite = await createViteServer({
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

  const httpServer: Server = await new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', () => resolve(server));
    server.once('error', reject);
  });
  console.log(`[NutriBodySim Engine v1.0] Server running on http://0.0.0.0:${port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[NutriBodySim] Received ${signal}; draining requests.`);
    await closeHttpServer(httpServer);
    await vite?.close();
    await runtime.close();
  };
  process.once('SIGINT', () => void shutdown('SIGINT').catch((error) => {
    console.error('[NutriBodySim] Graceful shutdown failed:', error);
    process.exitCode = 1;
  }));
  process.once('SIGTERM', () => void shutdown('SIGTERM').catch((error) => {
    console.error('[NutriBodySim] Graceful shutdown failed:', error);
    process.exitCode = 1;
  }));
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

startServer().catch(async (err) => {
  console.error(`[NutriBodySim] Fatal server startup failure (${err instanceof Error ? err.name : 'unknown error'}).`);
  await closeRuntimeDatabase().catch((closeError) => {
    console.error(`[NutriBodySim] Runtime cleanup failed (${closeError instanceof Error ? closeError.name : 'unknown error'}).`);
  });
  process.exit(1);
});
