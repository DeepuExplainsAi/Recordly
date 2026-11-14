import { putFile, RECORDINGS_DIR } from "./fileStore";
import { readNativeFile, ScreenRecorder } from "./nativeRecorder";

/** Moves a finished native recording into the on-device library and makes it the editor's source. */
export async function storeRecording(nativePath: string): Promise<string> {
	const blob = await readNativeFile(nativePath);
	const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
	const path = `${RECORDINGS_DIR}/recording-${stamp}.mp4`;
	await putFile(path, blob);
	await ScreenRecorder.deleteFile({ path: nativePath });
	await window.electronAPI.setCurrentRecordingSession({ videoPath: path });
	return path;
}
