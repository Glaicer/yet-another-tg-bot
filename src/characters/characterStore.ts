import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { getSetting, setSetting } from '../storage/settings.js';

export type CharacterInfo = {
  name: string;
  content: string;
};

export type CharacterStoreOptions = {
  db: Database.Database;
  directory: string;
  defaultName: string;
  hotReload: boolean;
};

export class CharacterStore {
  private db: Database.Database;
  private directory: string;
  private defaultName: string;
  private hotReload: boolean;
  private currentName: string;
  private currentContent: string;

  constructor(options: CharacterStoreOptions) {
    this.db = options.db;
    this.directory = options.directory;
    this.defaultName = options.defaultName;
    this.hotReload = options.hotReload;

    const defaultPath = path.join(this.directory, `${this.defaultName}.md`);
    if (!fs.existsSync(defaultPath) || !fs.statSync(defaultPath).isFile()) {
      throw new Error(`Default character file does not exist: ${defaultPath}`);
    }

    const persisted = getSetting(this.db, 'selected_character');
    if (persisted && this.characterExists(persisted)) {
      this.currentName = persisted;
    } else {
      this.currentName = this.defaultName;
      if (persisted && persisted !== this.currentName) {
        setSetting(this.db, 'selected_character', this.currentName);
      }
    }

    this.currentContent = fs.readFileSync(
      path.join(this.directory, `${this.currentName}.md`),
      'utf-8',
    );
  }

  listCharacters(): string[] {
    return this.readCharacterNames();
  }

  getCurrentCharacter(): CharacterInfo {
    if (!this.characterExists(this.currentName)) {
      this.currentName = this.defaultName;
      this.currentContent = fs.readFileSync(
        path.join(this.directory, `${this.currentName}.md`),
        'utf-8',
      );
      setSetting(this.db, 'selected_character', this.currentName);
      return { name: this.currentName, content: this.currentContent };
    }

    if (this.hotReload) {
      this.currentContent = fs.readFileSync(
        path.join(this.directory, `${this.currentName}.md`),
        'utf-8',
      );
    }

    return { name: this.currentName, content: this.currentContent };
  }

  selectCharacter(name: string): boolean {
    if (!this.characterExists(name)) {
      return false;
    }
    this.currentName = name;
    this.currentContent = fs.readFileSync(path.join(this.directory, `${name}.md`), 'utf-8');
    setSetting(this.db, 'selected_character', name);
    return true;
  }

  private readCharacterNames(): string[] {
    const entries = fs.readdirSync(this.directory);
    return entries
      .filter(
        (entry) => entry.endsWith('.md') && fs.statSync(path.join(this.directory, entry)).isFile(),
      )
      .map((entry) => entry.replace(/\.md$/, ''))
      .sort();
  }

  private characterExists(name: string): boolean {
    const filePath = path.join(this.directory, `${name}.md`);
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  }
}
