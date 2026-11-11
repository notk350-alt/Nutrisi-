import { describe, expect, it, vi } from 'vitest';
import {
  canAccessMaterialWithRepositories,
  canAccessProjectWithRepositories
} from '../auth/objectAuth';
import type { IDatabaseRepositories } from '../database/contracts';
import type { Material, Project, User } from '../database/types';

const user = (id: string, role: User['role'] = 'Researcher'): User => ({
  id,
  email: `${id}@example.test`,
  name: id,
  role,
  permissions: [],
  created_at: new Date(0).toISOString(),
  last_login_at: new Date(0).toISOString(),
  account_status: 'ACTIVE'
});

const project: Project = {
  id: 'private-project',
  name: 'Private project',
  description: '',
  type: 'Research',
  owner_id: 'owner',
  is_public: false,
  tags: [],
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString()
};

const material: Material = {
  id: 'private-material',
  title: 'Private material',
  author: 'Owner',
  subject: 'Research',
  type: 'TXT',
  description: '',
  language: 'en',
  tags: [],
  version: '1',
  uploaded_by: 'owner',
  file_path: 'private.txt',
  file_size_bytes: 0,
  mime_type: 'text/plain',
  file_hash: '',
  project_ids: [project.id],
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString()
};

function createRepositories(projectMembers: Array<{ user_id: string; role: string }> = []) {
  return {
    memberships: {
      getProjectMembers: vi.fn().mockResolvedValue(projectMembers),
      getTeamMembers: vi.fn().mockResolvedValue([])
    },
    projects: {
      findById: vi.fn().mockResolvedValue(project)
    }
  } as unknown as Pick<IDatabaseRepositories, 'memberships' | 'projects'>;
}

describe('repository-backed object authorization', () => {
  it('preserves ownership, membership roles, and private-project isolation', async () => {
    const repositories = createRepositories([{ user_id: 'editor', role: 'Editor' }]);

    await expect(canAccessProjectWithRepositories(repositories, user('owner'), project, 'WRITE'))
      .resolves.toMatchObject({ allowed: true });
    await expect(canAccessProjectWithRepositories(repositories, user('editor'), project, 'WRITE'))
      .resolves.toMatchObject({ allowed: true });
    await expect(canAccessProjectWithRepositories(repositories, user('outsider'), project, 'READ'))
      .resolves.toMatchObject({ allowed: false });
  });

  it('does not expose project-linked materials to unrelated users', async () => {
    const repositories = createRepositories();

    await expect(canAccessMaterialWithRepositories(repositories, user('outsider'), material, 'READ'))
      .resolves.toMatchObject({ allowed: false });
    await expect(canAccessMaterialWithRepositories(repositories, user('owner'), material, 'READ'))
      .resolves.toMatchObject({ allowed: true });
  });

  it('keeps global reference materials readable while rejecting inactive accounts', async () => {
    const repositories = createRepositories();
    const globalMaterial = { ...material, project_ids: [] };

    await expect(canAccessMaterialWithRepositories(repositories, user('reader'), globalMaterial, 'READ'))
      .resolves.toMatchObject({ allowed: true });
    await expect(canAccessMaterialWithRepositories(
      repositories,
      { ...user('suspended'), account_status: 'SUSPENDED' },
      globalMaterial,
      'READ'
    )).resolves.toMatchObject({ allowed: false });
  });
});
