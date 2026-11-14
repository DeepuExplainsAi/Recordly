import { Capacitor, registerPlugin } from "@capacitor/core";

interface ScreenRecorderPlugin {
	start(options: { audio: boolean }): Promise<{ audio: boolean }>;
	stop(): Promise<{ path: string }>;
	isRecording(): Promise<{ recording: boolean }>;
	deleteFile(options: { path: string }): Promise<void>;
	saveToGallery(options: {
		path: string;
		fileName: string;
		mime: string;
	}): Promise<{ uri: string; folder: string }>;
}

export const ScreenRecorder = registerPlugin<ScreenRecorderPlugin>("ScreenRecorder");

export const isNativeAndroid = () => Capacitor.isNativePlatform();

/** Reads a native cache file into a Blob through the WebView's local file route. */
export async function readNativeFile(path: string): Promise<Blob> {
	const response = await fetch(Capacitor.convertFileSrc(`file://${path}`));
	if (!response.ok) throw new Error(`Could not read recording (${response.status})`);
	return response.blob();
}
