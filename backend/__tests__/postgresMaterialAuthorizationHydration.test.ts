import { describe, expect, it } from 'vitest';
import { PostgresMaterialRepository } from '../database/adapters/postgresDatabase';
import * as schema from '../database/schema';

describe('PostgreSQL material authorization data', () => {
  it('hydrates project IDs from the material-project junction on material reads', async () => {
    const materialRow = {
      id: 'private-material',
      title: 'Private material',
      author: 'Owner',
      subject: 'Research',
      type: 'TXT',
      description: '',
      language: 'en',
      tags: [],
      version: '1',
      uploadedBy: 'owner',
      filePath: 'private.txt',
      fileSizeBytes: 0,
      mimeType: 'text/plain',
      fileHash: '',
      createdAt: new Date(0),
      updatedAt: new Date(0)
    };
    const queryRows = new Map<unknown, unknown[]>([
      [schema.materials, [materialRow]],
      [schema.materialProjects, [{ projectId: 'private-project' }]]
    ]);

    const db = {
      select: () => {
        let table: unknown;
        let rowLimit: number | undefined;
        const query: any = {
          from(value: unknown) {
            table = value;
            return query;
          },
          where() {
            return query;
          },
          limit(value: number) {
            rowLimit = value;
            return query;
          },
          then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
            const rows = queryRows.get(table) ?? [];
            return Promise.resolve(rowLimit === undefined ? rows : rows.slice(0, rowLimit))
              .then(resolve, reject);
          }
        };
        return query;
      }
    };

    const material = await new PostgresMaterialRepository(db as any).findById('private-material');

    expect(material?.project_ids).toEqual(['private-project']);
  });
});
