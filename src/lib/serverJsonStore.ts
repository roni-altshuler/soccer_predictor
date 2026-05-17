import fs from 'fs'
import os from 'os'
import path from 'path'

const STORE_DIR = process.env.FOTPREDICT_STORE_DIR || path.join(os.tmpdir(), 'fotpredict-server-store')

function ensureStoreDir(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true })
  }
}

function storePath(fileName: string): string {
  ensureStoreDir()
  return path.join(STORE_DIR, fileName)
}

export function readJsonStore<T>(fileName: string, fallback: T): T {
  const filePath = storePath(fileName)
  if (!fs.existsSync(filePath)) return fallback

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

export function writeJsonStore<T>(fileName: string, value: T): void {
  const filePath = storePath(fileName)
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2))
  fs.renameSync(tempPath, filePath)
}

export function getJsonStoreMeta() {
  return {
    storage: process.env.FOTPREDICT_STORE_DIR ? 'configured_file_store' : 'ephemeral_file_store',
    durable: Boolean(process.env.FOTPREDICT_STORE_DIR),
    note: process.env.FOTPREDICT_STORE_DIR
      ? 'Server sync is backed by FOTPREDICT_STORE_DIR.'
      : 'Server sync is using the runtime temp directory. Configure FOTPREDICT_STORE_DIR or a database before production launch.',
  }
}
