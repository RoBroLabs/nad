import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { getDataDirectory, getModuleArtifactDirectory } from '@/lib/runtime/data-dir';

const originalDataDirectory = process.env.NAD_DATA_DIR;
const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDataDirectory === undefined) delete process.env.NAD_DATA_DIR;
  else process.env.NAD_DATA_DIR = originalDataDirectory;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe('module data directories', () => {
  it('uses the explicit data directory first', () => {
    process.env.NAD_DATA_DIR = './fixtures/operator-data';
    process.env.DATABASE_URL = 'file:./ignored/nad.db';
    expect(getDataDirectory()).toBe(resolve('./fixtures/operator-data'));
  });

  it('keeps module artifacts beside a configured SQLite database', () => {
    delete process.env.NAD_DATA_DIR;
    process.env.DATABASE_URL = 'file:./fixtures/operator-data/nad.db';
    expect(getModuleArtifactDirectory()).toBe(resolve('./fixtures/operator-data/modules'));
  });
});
