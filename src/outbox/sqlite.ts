/**
 * The outbox in SQLite on the device: changes survive the app being closed or killed. Apps with
 * PHI build with SQLCipher (app.config.ts) and open the database with a random key kept in the
 * Keychain or Keystore, so the queued changes are encrypted at rest.
 */
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type { Command, OutboxStore } from "./outbox";

const NAME = "outbox.db";
const KEY = "outbox-key";

async function databaseKey(): Promise<string> {
  const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  const existing = await SecureStore.getItemAsync(KEY, options);
  if (existing) return existing;
  const key = Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, "0")).join("");
  await SecureStore.setItemAsync(KEY, key, options);
  return key;
}

export async function sqliteStore(encrypted: boolean): Promise<OutboxStore> {
  const db = await SQLite.openDatabaseAsync(NAME);
  if (encrypted) {
    // Must come first, before anything reads the database. Hex keys are used as is, no derivation.
    await db.execAsync(`PRAGMA key = "x'${await databaseKey()}'"`);
  }
  await db.execAsync(
    "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL, command TEXT NOT NULL)",
  );
  return {
    async all() {
      const rows = await db.getAllAsync<{ command: string }>(
        "SELECT command FROM outbox ORDER BY created_at, id",
      );
      return rows.map((row) => JSON.parse(row.command) as Command);
    },
    async put(command) {
      await db.runAsync(
        "INSERT OR REPLACE INTO outbox (id, created_at, command) VALUES (?, ?, ?)",
        command.id,
        command.createdAt,
        JSON.stringify(command),
      );
    },
    async remove(id) {
      await db.runAsync("DELETE FROM outbox WHERE id = ?", id);
    },
    async clear() {
      await db.runAsync("DELETE FROM outbox");
      await db.execAsync("VACUUM");
    },
  };
}
