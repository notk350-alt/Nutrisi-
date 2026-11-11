import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRouter } from '../routes/api';
import { initializeRuntimeDatabase } from '../database/runtime';
import type { IDatabaseRepositories } from '../database/contracts';
import type { User } from '../database/types';

describe('API repository routing', () => {
  let server: Server;
  let baseUrl: string;
  let repositories: IDatabaseRepositories;
  let owner: User;
  let outsider: User;
  let ownerToken: string;
  let outsiderToken: string;
  let projectId: string | undefined;
  let materialId: string | undefined;

  beforeAll(async () => {
    const runtime = await initializeRuntimeDatabase();
    repositories = runtime.repositories;

    owner = (await repositories.users.findById('usr_admin'))!;
    outsider = (await repositories.users.findById('usr_student'))!;
    expect(owner).toBeTruthy();
    expect(outsider).toBeTruthy();

    ownerToken = (await repositories.sessions.createSession(
      owner.id,
      3600,
      owner.token_version || 1
    )).token;
    outsiderToken = (await repositories.sessions.createSession(
      outsider.id,
      3600,
      outsider.token_version || 1
    )).token;

    const app = express();
    app.use(express.json(), apiRouter);
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: error.message });
    });

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', resolve);
      server.once('error', reject);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    if (materialId) await repositories.materials.delete(materialId);
    if (projectId) {
      await repositories.memberships.removeProjectMember(projectId, owner.id);
      await repositories.projects.delete(projectId);
    }
    if (ownerToken) await repositories.sessions.revokeSession(ownerToken);
    if (outsiderToken) await repositories.sessions.revokeSession(outsiderToken);
  });

  async function get(path: string, token: string) {
    return fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  it('creates projects through repositories and enforces private-project BOLA', async () => {
    const created = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: 'Repository route isolation test', is_public: false })
    });

    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody).toHaveProperty('project');
    projectId = createdBody.project.id;

    const ownerRead = await get(`/projects/${projectId}`, ownerToken);
    expect(ownerRead.status).toBe(200);
    expect((await ownerRead.json()).project.id).toBe(projectId);

    const outsiderRead = await get(`/projects/${projectId}`, outsiderToken);
    expect(outsiderRead.status).toBe(403);
    expect(await outsiderRead.json()).toMatchObject({
      code: 'OBJECT_ACCESS_DENIED',
      entity_type: 'PROJECT',
      entity_id: projectId
    });
  });

  it('excludes a private project-linked material from unrelated users', async () => {
    expect(projectId).toBeTruthy();
    const now = new Date().toISOString();
    materialId = `api-route-material-${Date.now()}`;
    await repositories.materials.create({
      id: materialId,
      title: 'Private linked material',
      author: owner.name,
      subject: 'Research',
      type: 'TXT',
      description: '',
      language: 'en',
      tags: [],
      version: '1',
      uploaded_by: owner.id,
      file_path: 'private-route-test.txt',
      file_size_bytes: 0,
      mime_type: 'text/plain',
      file_hash: '',
      project_ids: [projectId!],
      created_at: now,
      updated_at: now
    });

    const response = await get('/materials', outsiderToken);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.materials.some((material: { id: string }) => material.id === materialId)).toBe(false);
  });
});
