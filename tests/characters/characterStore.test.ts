import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CharacterStore } from '../../src/characters/characterStore.js';
import { createDatabase } from '../../src/storage/database.js';
import { getSetting, setSetting } from '../../src/storage/settings.js';

describe('characterStore', () => {
  let tempDir: string;
  let charsDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'char-test-'));
    charsDir = path.join(tempDir, 'characters');
    fs.mkdirSync(charsDir);
    dbPath = path.join(tempDir, 'test.sqlite');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('lists characters from directory', () => {
    fs.writeFileSync(path.join(charsDir, 'default.md'), 'Default content');
    fs.writeFileSync(path.join(charsDir, 'wizard.md'), 'Wizard content');
    fs.writeFileSync(path.join(charsDir, 'readme.txt'), 'ignored');

    const db = createDatabase(dbPath);
    const store = new CharacterStore({
      db,
      directory: charsDir,
      defaultName: 'default',
      hotReload: false,
    });

    const names = store.listCharacters();
    expect(names).toEqual(['default', 'wizard']);
    db.close();
  });

  it('derives character names from .md filenames', () => {
    fs.writeFileSync(path.join(charsDir, 'default.md'), 'Default content');
    fs.writeFileSync(path.join(charsDir, 'some-name.md'), 'Some content');

    const db = createDatabase(dbPath);
    const store = new CharacterStore({
      db,
      directory: charsDir,
      defaultName: 'default',
      hotReload: false,
    });

    const names = store.listCharacters();
    expect(names).toContain('default');
    expect(names).toContain('some-name');
    expect(names).not.toContain('default.md');
    db.close();
  });

  it('returns default character on initialization when no persistence', () => {
    fs.writeFileSync(path.join(charsDir, 'default.md'), 'Default content');

    const db = createDatabase(dbPath);
    const store = new CharacterStore({
      db,
      directory: charsDir,
      defaultName: 'default',
      hotReload: false,
    });

    const current = store.getCurrentCharacter();
    expect(current.name).toBe('default');
    expect(current.content).toBe('Default content');
    db.close();
  });

  it('returns persisted character when valid', () => {
    fs.writeFileSync(path.join(charsDir, 'default.md'), 'Default content');
    fs.writeFileSync(path.join(charsDir, 'wizard.md'), 'Wizard content');

    const db = createDatabase(dbPath);
    setSetting(db, 'selected_character', 'wizard');

    const store = new CharacterStore({
      db,
      directory: charsDir,
      defaultName: 'default',
      hotReload: false,
    });

    const current = store.getCurrentCharacter();
    expect(current.name).toBe('wizard');
    expect(current.content).toBe('Wizard content');
    db.close();
  });

  it('falls back to default when persisted character is missing', () => {
    fs.writeFileSync(path.join(charsDir, 'default.md'), 'Default content');

    const db = createDatabase(dbPath);
    setSetting(db, 'selected_character', 'missing');

    const store = new CharacterStore({
      db,
      directory: charsDir,
      defaultName: 'default',
      hotReload: false,
    });

    const current = store.getCurrentCharacter();
    expect(current.name).toBe('default');
    expect(current.content).toBe('Default content');
    db.close();
  });

  it('selectCharacter selects existing character and persists', () => {
    fs.writeFileSync(path.join(charsDir, 'default.md'), 'Default content');
    fs.writeFileSync(path.join(charsDir, 'wizard.md'), 'Wizard content');

    const db = createDatabase(dbPath);
    const store = new CharacterStore({
      db,
      directory: charsDir,
      defaultName: 'default',
      hotReload: false,
    });

    const result = store.selectCharacter('wizard');
    expect(result).toBe(true);

    const current = store.getCurrentCharacter();
    expect(current.name).toBe('wizard');
    expect(current.content).toBe('Wizard content');

    const persisted = getSetting(db, 'selected_character');
    expect(persisted).toBe('wizard');
    db.close();
  });

  it('selectCharacter rejects unknown name and leaves current unchanged', () => {
    fs.writeFileSync(path.join(charsDir, 'default.md'), 'Default content');

    const db = createDatabase(dbPath);
    const store = new CharacterStore({
      db,
      directory: charsDir,
      defaultName: 'default',
      hotReload: false,
    });

    const result = store.selectCharacter('unknown');
    expect(result).toBe(false);

    const current = store.getCurrentCharacter();
    expect(current.name).toBe('default');
    expect(current.content).toBe('Default content');

    const persisted = getSetting(db, 'selected_character');
    expect(persisted).toBeUndefined();
    db.close();
  });

  it('hot reload re-reads content from disk', () => {
    fs.writeFileSync(path.join(charsDir, 'default.md'), 'Original content');

    const db = createDatabase(dbPath);
    const store = new CharacterStore({
      db,
      directory: charsDir,
      defaultName: 'default',
      hotReload: true,
    });

    expect(store.getCurrentCharacter().content).toBe('Original content');

    fs.writeFileSync(path.join(charsDir, 'default.md'), 'Updated content');
    expect(store.getCurrentCharacter().content).toBe('Updated content');
    db.close();
  });

  it('without hot reload content is cached', () => {
    fs.writeFileSync(path.join(charsDir, 'default.md'), 'Original content');

    const db = createDatabase(dbPath);
    const store = new CharacterStore({
      db,
      directory: charsDir,
      defaultName: 'default',
      hotReload: false,
    });

    expect(store.getCurrentCharacter().content).toBe('Original content');

    fs.writeFileSync(path.join(charsDir, 'default.md'), 'Updated content');
    expect(store.getCurrentCharacter().content).toBe('Original content');
    db.close();
  });

  it('falls back to default at runtime if selected character disappears', () => {
    fs.writeFileSync(path.join(charsDir, 'default.md'), 'Default content');
    fs.writeFileSync(path.join(charsDir, 'wizard.md'), 'Wizard content');

    const db = createDatabase(dbPath);
    const store = new CharacterStore({
      db,
      directory: charsDir,
      defaultName: 'default',
      hotReload: false,
    });

    store.selectCharacter('wizard');
    expect(store.getCurrentCharacter().name).toBe('wizard');

    fs.unlinkSync(path.join(charsDir, 'wizard.md'));
    const current = store.getCurrentCharacter();
    expect(current.name).toBe('default');
    expect(current.content).toBe('Default content');
    db.close();
  });

  it('throws when default character does not exist at initialization', () => {
    const db = createDatabase(dbPath);
    expect(() => {
      new CharacterStore({
        db,
        directory: charsDir,
        defaultName: 'missing',
        hotReload: false,
      });
    }).toThrow('Default character file does not exist');
    db.close();
  });

  it('persists fallback to default when persisted character is missing', () => {
    fs.writeFileSync(path.join(charsDir, 'default.md'), 'Default content');

    const db = createDatabase(dbPath);
    setSetting(db, 'selected_character', 'missing');

    new CharacterStore({
      db,
      directory: charsDir,
      defaultName: 'default',
      hotReload: false,
    });

    const persisted = getSetting(db, 'selected_character');
    expect(persisted).toBe('default');
    db.close();
  });
});
