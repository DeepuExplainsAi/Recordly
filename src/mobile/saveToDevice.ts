/** Hands a finished file to the user. Replaced by Capacitor Filesystem/Share in the Android build. */
export async function saveToDevice(
	blob: Blob,
	fileName: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
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
