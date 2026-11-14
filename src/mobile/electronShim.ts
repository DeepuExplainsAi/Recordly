/**
 * Replaces the Electron preload bridge with an on-device implementation.
 * Files live in IndexedDB (see fileStore.ts); settings live in localStorage.
 * Nothing here talks to a server.
 */
import {
	baseName,
	deleteFile,
	EXPORTS_DIR,
	getFile,
	getMediaUrl,
	IMPORTS_DIR,
	listFiles,
	PROJECTS_DIR,
	putFile,
	RECORDINGS_DIR,
	safeFileName,
} from "./fileStore";
import { saveToDevice } from "./saveToDevice";

type Api = Record<string, unknown>;

const PROJECT_EXT = ".recordly";
const SETTING_PREFIX = "recordly.setting.";
const unavailable = { success: false, error: "Not available on mobile" };

function readJson<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw === null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

function writeJson(key: string, value: unknown) {
	localStorage.setItem(key, JSON.stringify(value));
}

const state = {
	currentVideoPath: sessionStorage.getItem("recordly.currentVideoPath") as string | null,
	currentProjectPath: sessionStorage.getItem("recordly.currentProjectPath") as string | null,
	session: readJson<Record<string, unknown> | null>("recordly.session", null),
};

function persistState() {
	const set = (key: string, value: string | null) =>
		value ? sessionStorage.setItem(key, value) : sessionStorage.removeItem(key);
	set("recordly.currentVideoPath", state.currentVideoPath);
	set("recordly.currentProjectPath", state.currentProjectPath);
	writeJson("recordly.session", state.session);
}

function uniquePath(dir: string, name: string, ext: string, taken: Set<string>): string {
	const stem = safeFileName(name).replace(new RegExp(`${ext.replace(".", "\\.")}$`, "i"), "");
	let candidate = `${dir}/${stem}${ext}`;
	for (let i = 2; taken.has(candidate); i++) candidate = `${dir}/${stem} ${i}${ext}`;
	return candidate;
}

async function pickFile(accept: string): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = accept;
		input.style.display = "none";
		input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
		input.addEventListener("cancel", () => resolve(null));
		document.body.appendChild(input);
		input.click();
		setTimeout(() => input.remove(), 60_000);
	});
}

async function importPickedFile(file: File): Promise<string> {
	const taken = new Set((await listFiles(IMPORTS_DIR)).map((entry) => entry.path));
	const ext = file.name.includes(".") ? `.${file.name.split(".").pop()}` : ".mp4";
	const path = uniquePath(IMPORTS_DIR, file.name.replace(/\.[^.]+$/, ""), ext, taken);
	await putFile(path, file);
	return path;
}

const thumbnailCache = new Map<string, string>();

async function videoThumbnail(path: string): Promise<string | null> {
	const cached = thumbnailCache.get(path);
	if (cached) return cached;
	const url = await getMediaUrl(path);
	if (!url) return null;
	const video = document.createElement("video");
	video.muted = true;
	video.preload = "auto";
	video.src = url;
	try {
		await new Promise<void>((resolve, reject) => {
			video.onloadeddata = () => resolve();
			video.onerror = () => reject(new Error("decode"));
		});
		video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
		await new Promise<void>((resolve) => {
			video.onseeked = () => resolve();
		});
		const canvas = document.createElement("canvas");
		const scale = Math.min(1, 480 / (video.videoWidth || 480));
		canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
		canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
		canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
		const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
		thumbnailCache.set(path, dataUrl);
		return dataUrl;
	} catch {
		return null;
	} finally {
		video.removeAttribute("src");
		video.load();
	}
}

async function readProject(path: string): Promise<unknown | null> {
	const file = await getFile(path);
	if (!file) return null;
	try {
		return JSON.parse(await file.blob.text());
	} catch {
		return null;
	}
}

async function saveProject(data: unknown, name: string, existingPath?: string | null) {
	const taken = new Set((await listFiles(PROJECTS_DIR)).map((entry) => entry.path));
	const path = existingPath ?? uniquePath(PROJECTS_DIR, name || "Untitled", PROJECT_EXT, taken);
	await putFile(path, new Blob([JSON.stringify(data)], { type: "application/json" }));
	state.currentProjectPath = path;
	persistState();
	return { success: true, path, projectId: path };
}

const exportStreams = new Map<string, { extension: string; parts: Array<[number, Uint8Array]> }>();

function assemble(parts: Array<[number, Uint8Array]>): Uint8Array {
	const size = parts.reduce((max, [pos, chunk]) => Math.max(max, pos + chunk.byteLength), 0);
	const out = new Uint8Array(size);
	for (const [pos, chunk] of parts) out.set(chunk, pos);
	return out;
}

const implemented: Api = {
	// --- environment ---
	getPlatform: async () => "android",
	getAppVersion: async () => "2.0.0-beta.1",
	getLinuxWindowSystem: async () => null,
	getWindowChrome: async () => ({ trafficLightsVisible: false, customControls: false }),
	isWindowFullscreen: async () => false,
	getEditorStartupView: () =>
		new URLSearchParams(location.search).get("startupView") === "editor" ? "editor" : "home",
	getAssetBasePath: async () => null,
	listAssetDirectory: async () => ({ success: false }),
	getAnnouncements: async () => null,
	openExternalUrl: async (url: string) => {
		window.open(url, "_blank");
		return { success: true };
	},
	writeClipboardText: async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			return { success: true };
		} catch {
			return unavailable;
		}
	},
	setAppLocale: async () => true,

	// --- settings ---
	getAppSetting: (key: string) => readJson(SETTING_PREFIX + key, null),
	getAppSettingWithStatus: (key: string) => {
		const raw = localStorage.getItem(SETTING_PREFIX + key);
		return {
			success: true,
			found: raw !== null,
			value: raw === null ? null : JSON.parse(raw),
		};
	},
	setAppSetting: (key: string, value: unknown) => {
		writeJson(SETTING_PREFIX + key, value);
		return true;
	},
	getShortcuts: async () => readJson("recordly.shortcuts", null),
	saveShortcuts: async (shortcuts: unknown) => {
		writeJson("recordly.shortcuts", shortcuts);
		return { success: true };
	},
	getApplicationPreferences: async () => ({
		success: true,
		showInDock: false,
		hideWhileRecording: false,
		launchAtLogin: false,
		launchAtLoginSupported: false,
		platform: "android",
	}),
	getRecordingPreferences: async () => ({
		success: true,
		microphoneEnabled: false,
		systemAudioEnabled: false,
		webcamEnabled: false,
		...readJson("recordly.recordingPreferences", {}),
	}),
	setRecordingPreferences: async (prefs: object) => {
		writeJson("recordly.recordingPreferences", {
			...readJson("recordly.recordingPreferences", {}),
			...prefs,
		});
		return { success: true };
	},
	getCountdownDelay: async () => ({ success: true, delay: readJson("recordly.countdown", 3) }),
	setCountdownDelay: async (delay: number) => {
		writeJson("recordly.countdown", delay);
		return { success: true };
	},
	getRecordingAudioLabConfig: async () => ({
		browserMicrophoneProfile: "default",
		requestedBrowserMicrophoneProfile: null,
	}),
	authStorageAvailable: async () => false,

	// --- files & media ---
	getLocalMediaUrl: async (path: string) => {
		const url = await getMediaUrl(path);
		return url ? { success: true, url } : { success: false };
	},
	readLocalFile: async (path: string) => {
		const file = await getFile(path);
		return file
			? { success: true, data: new Uint8Array(await file.blob.arrayBuffer()) }
			: { success: false, error: "File not found" };
	},
	getRecordingsDirectory: async () => ({ success: true, path: RECORDINGS_DIR, isDefault: true }),
	getProjectsDirectory: async () => ({ success: true, path: PROJECTS_DIR }),
	getRecordingThumbnail: async (path: string) => {
		const value = await videoThumbnail(path);
		return value ? { success: true, value } : { success: false, error: "No thumbnail" };
	},
	openVideoFilePicker: async (options?: { includeProjects?: boolean }) => {
		const file = await pickFile(options?.includeProjects ? "video/*,.recordly" : "video/*");
		if (!file) return { success: false, canceled: true };
		if (file.name.endsWith(PROJECT_EXT)) {
			const project = JSON.parse(await file.text());
			const saved = await saveProject(project, file.name.replace(/\.recordly$/, ""));
			return { success: true, kind: "project", path: saved.path, project };
		}
		const path = await importPickedFile(file);
		state.currentVideoPath = path;
		state.currentProjectPath = null;
		state.session = null;
		persistState();
		return { success: true, kind: "media", path, extension: path.split(".").pop() };
	},
	openAudioFilePicker: async () => {
		const file = await pickFile("audio/*");
		return file
			? { success: true, path: await importPickedFile(file) }
			: { success: false, canceled: true };
	},

	// --- current source ---
	getCurrentVideoPath: async () =>
		state.currentVideoPath
			? { success: true, path: state.currentVideoPath }
			: { success: false },
	setCurrentVideoPath: async (path: string, options?: { preserveProjectPath?: boolean }) => {
		state.currentVideoPath = path;
		state.session = null;
		if (!options?.preserveProjectPath) state.currentProjectPath = null;
		persistState();
		return { success: true };
	},
	clearCurrentVideoPath: async () => {
		state.currentVideoPath = null;
		state.session = null;
		persistState();
		return { success: true };
	},
	setCurrentRecordingSession: async (session: Record<string, unknown>) => {
		state.session = session;
		state.currentVideoPath = (session.videoPath as string) ?? null;
		state.currentProjectPath = null;
		persistState();
		return { success: true };
	},
	getCurrentRecordingSession: async () =>
		state.session ? { success: true, session: state.session } : { success: false },
	getVideoAudioFallbackPaths: async () => ({ success: true, paths: [] }),

	// --- library ---
	listRecordings: async () => {
		const files = [...(await listFiles(RECORDINGS_DIR)), ...(await listFiles(IMPORTS_DIR))];
		const value = await Promise.all(
			files
				.sort((a, b) => b.createdAt - a.createdAt)
				.map(async (file) => ({
					path: file.path,
					name: baseName(file.path),
					createdAt: file.createdAt,
					bytes: file.blob.size,
					url: (await getMediaUrl(file.path)) ?? "",
				})),
		);
		return { success: true, value };
	},
	findDuplicateRecordingSources: async () => ({ success: true, value: [] }),
	deleteRecordingFile: async (path: string) => {
		await deleteFile(path);
		return { success: true };
	},
	listProjectFiles: async () => ({
		success: true,
		projectsDir: PROJECTS_DIR,
		entries: (await listFiles(PROJECTS_DIR))
			.filter((file) => file.path.endsWith(PROJECT_EXT))
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map((file) => ({
				path: file.path,
				name: baseName(file.path).replace(/\.recordly$/, ""),
				createdAt: file.createdAt,
				updatedAt: file.updatedAt,
				thumbnailPath: null,
				isCurrent: file.path === state.currentProjectPath,
				isInProjectsDirectory: true,
			})),
	}),
	getProjectPreview: async (path: string) => {
		const [file, project] = await Promise.all([getFile(path), readProject(path)]);
		const videoPath = (project as { videoPath?: string } | null)?.videoPath;
		if (!file || !project || !videoPath) return { success: false, error: "Project not found" };
		const videoUrl = await getMediaUrl(videoPath);
		if (!videoUrl) return { success: false, error: "Project video not found" };
		return {
			success: true,
			value: {
				project,
				revision: String(file.updatedAt),
				videoUrl,
				webcamUrl: null,
				sourcePaths: [videoPath],
				sourcePathsComplete: true,
			},
		};
	},
	cacheProjectThumbnail: async () => ({ success: true, value: null }),
	openProjectFileAtPath: async (path: string) => {
		const project = await readProject(path);
		if (!project) return { success: false, error: "Project not found" };
		state.currentProjectPath = path;
		state.currentVideoPath = (project as { videoPath?: string }).videoPath ?? null;
		state.session = null;
		persistState();
		return { success: true, path, project };
	},
	loadCurrentProjectFile: async () => {
		if (!state.currentProjectPath) return { success: false };
		const project = await readProject(state.currentProjectPath);
		return project
			? { success: true, path: state.currentProjectPath, project }
			: { success: false, path: state.currentProjectPath };
	},
	saveProjectFile: async (data: unknown, name?: string, existingPath?: string) =>
		saveProject(data, name ?? "Untitled", existingPath),
	saveProjectFileNamed: async (data: unknown, name: string) => saveProject(data, name),
	createProjectFile: async (data: unknown, _thumb?: unknown) => saveProject(data, "Untitled"),
	trashProjectFiles: async (paths: string[]) => {
		await Promise.all(paths.map(deleteFile));
		return { success: true };
	},

	// --- export ---
	openExportStream: async (options?: { extension?: string }) => {
		const streamId = crypto.randomUUID();
		exportStreams.set(streamId, { extension: options?.extension ?? "mp4", parts: [] });
		return { success: true, streamId, tempPath: `${EXPORTS_DIR}/.tmp-${streamId}` };
	},
	writeExportStreamChunk: async (streamId: string, position: number, chunk: Uint8Array) => {
		const stream = exportStreams.get(streamId);
		if (!stream) return { success: false, error: "Unknown stream" };
		stream.parts.push([position, new Uint8Array(chunk)]);
		return { success: true };
	},
	closeExportStream: async (streamId: string, options?: { abort?: boolean }) => {
		const stream = exportStreams.get(streamId);
		exportStreams.delete(streamId);
		if (!stream || options?.abort) return { success: true };
		const bytes = assemble(stream.parts);
		const tempPath = `${EXPORTS_DIR}/.tmp-${streamId}.${stream.extension}`;
		await putFile(tempPath, new Blob([bytes as BlobPart]));
		return { success: true, tempPath, bytesWritten: bytes.byteLength };
	},
	finalizeExportedVideo: async (payload: { tempPath: string; fileName: string }) => {
		const file = await getFile(payload.tempPath);
		if (!file) return { success: false, error: "Export file missing" };
		const result = await saveToDevice(file.blob, payload.fileName);
		await deleteFile(payload.tempPath);
		return result;
	},
	discardExportedTemp: async (tempPath: string) => {
		await deleteFile(tempPath);
		return { success: true };
	},
	saveExportedVideo: async (data: ArrayBuffer, fileName: string) =>
		saveToDevice(new Blob([data]), fileName),
	setExportInProgress: () => undefined,
	setHasUnsavedChanges: () => undefined,
};

const fallbackCache = new Map<string, unknown>();

/** Anything not implemented: `on*` subscribers get a no-op unsubscribe, the rest report unavailable. */
const api = new Proxy(implemented, {
	get(target, prop) {
		if (typeof prop !== "string" || prop in target) return Reflect.get(target, prop);
		let fallback = fallbackCache.get(prop);
		if (!fallback) {
			fallback = prop.startsWith("on") ? () => () => undefined : async () => unavailable;
			fallbackCache.set(prop, fallback);
		}
		return fallback;
	},
});

export function installElectronShim() {
	(window as unknown as { electronAPI: unknown }).electronAPI = api;
}
