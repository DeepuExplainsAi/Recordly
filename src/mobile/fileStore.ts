/** On-device virtual filesystem: IndexedDB blobs addressed by absolute-looking paths. */

export interface StoredFile {
	path: string;
	blob: Blob;
	createdAt: number;
	updatedAt: number;
}

const DB_NAME = "recordly-mobile";
const STORE = "files";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	dbPromise ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "path" });
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
	const db = await openDb();
	return new Promise<T>((resolve, reject) => {
		const request = action(db.transaction(STORE, mode).objectStore(STORE));
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export async function putFile(path: string, blob: Blob): Promise<StoredFile> {
	const existing = await getFile(path);
	const now = Date.now();
	const file = { path, blob, createdAt: existing?.createdAt ?? now, updatedAt: now };
	await run("readwrite", (store) => store.put(file));
	revokeMediaUrl(path);
	return file;
}

export async function getFile(path: string): Promise<StoredFile | undefined> {
	return run<StoredFile | undefined>("readonly", (store) => store.get(path));
}

export async function deleteFile(path: string): Promise<void> {
	await run("readwrite", (store) => store.delete(path));
	revokeMediaUrl(path);
}

export async function listFiles(prefix: string): Promise<StoredFile[]> {
	const all = await run<StoredFile[]>("readonly", (store) => store.getAll());
	return all.filter((file) => file.path.startsWith(prefix));
}

const mediaUrls = new Map<string, string>();

export async function getMediaUrl(path: string): Promise<string | null> {
	const cached = mediaUrls.get(path);
	if (cached) return cached;
	const file = await getFile(path);
	if (!file) return null;
	const url = URL.createObjectURL(file.blob);
	mediaUrls.set(path, url);
	return url;
}

function revokeMediaUrl(path: string) {
	const url = mediaUrls.get(path);
	if (url) URL.revokeObjectURL(url);
	mediaUrls.delete(path);
}

export const RECORDINGS_DIR = "/recordly/recordings";
export const PROJECTS_DIR = "/recordly/projects";
export const EXPORTS_DIR = "/recordly/exports";
export const IMPORTS_DIR = "/recordly/imports";

export function baseName(path: string): string {
	return path.split("/").filter(Boolean).pop() ?? path;
}

export function safeFileName(name: string): string {
	return name.replace(/[^\w.\- ]+/g, "_").trim() || "untitled";
}
