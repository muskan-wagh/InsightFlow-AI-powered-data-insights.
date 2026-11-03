import { openDB, DBSchema, IDBPDatabase } from "idb"

interface FilesDB extends DBSchema {
  files: {
    key: string
    value: { csv: string; fileName: string }
  }
}

let dbPromise: Promise<IDBPDatabase<FilesDB>> | null = null

function getDb(): Promise<IDBPDatabase<FilesDB>> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB is browser-only"))
  }
  if (!dbPromise) {
    dbPromise = openDB("insightflow-files", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("files")) {
          db.createObjectStore("files")
        }
      },
    })
  }
  return dbPromise
}

export async function saveDatasetFile(id: string, csv: string, fileName: string): Promise<void> {
  try {
    const db = await getDb()
    await db.put("files", { csv, fileName }, id)
  } catch {
    // storage may be unavailable (private mode); dataset stays session-only
  }
}

export async function loadDatasetFile(id: string): Promise<{ csv: string; fileName: string } | null> {
  try {
    const db = await getDb()
    return (await db.get("files", id)) ?? null
  } catch {
    return null
  }
}

export async function deleteDatasetFile(id: string): Promise<void> {
  try {
    const db = await getDb()
    await db.delete("files", id)
  } catch {
    // ignore
  }
}

export async function listDatasetIds(): Promise<string[]> {
  try {
    const db = await getDb()
    return (await db.getAllKeys("files")).map(String)
  } catch {
    return []
  }
}
