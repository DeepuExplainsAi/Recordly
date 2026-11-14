import { Directory, Filesystem } from "@capacitor/filesystem";
import { isNativeAndroid, ScreenRecorder } from "./nativeRecorder";

const CHUNK_BYTES = 3 * 1024 * 1024; // multiple of 3 so each base64 chunk concatenates cleanly

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

function mimeFor(fileName: string): string {
	const ext = fileName.split(".").pop()?.toLowerCase();
	if (ext === "gif") return "image/gif";
	if (ext === "webm") return "video/webm";
	return "video/mp4";
}

/** Saves a finished export to the phone gallery (Movies/Recordly); falls back to a download in a plain browser. */
export async function saveToDevice(
	blob: Blob,
	fileName: string,
): Promise<{ success: boolean; path?: string; message?: string; error?: string }> {
	if (!isNativeAndroid()) {
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = fileName;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 30_000);
		return { success: true, path: fileName };
	}

	const scratch = `exports/${Date.now()}-${fileName}`;
	try {
		for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
			const chunk = new Uint8Array(await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
			const data = toBase64(chunk);
			if (offset === 0) {
				await Filesystem.writeFile({ path: scratch, data, directory: Directory.Cache, recursive: true });
			} else {
				await Filesystem.appendFile({ path: scratch, data, directory: Directory.Cache });
			}
		}
		const { uri } = await Filesystem.getUri({ path: scratch, directory: Directory.Cache });
		const result = await ScreenRecorder.saveToGallery({
			path: uri.replace(/^file:\/\//, ""),
			fileName,
			mime: mimeFor(fileName),
		});
		return { success: true, path: result.uri, message: `Saved to ${result.folder}` };
	} catch (e) {
		await Filesystem.deleteFile({ path: scratch, directory: Directory.Cache }).catch(() => undefined);
		return { success: false, error: e instanceof Error ? e.message : String(e) };
	}
}
