import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isNativeAndroid, ScreenRecorder } from "./nativeRecorder";
import { storeRecording } from "./saveRecording";

export const OPEN_RECORDER_EVENT = "recordly:open-recorder";

type Phase = "closed" | "idle" | "starting" | "recording" | "saving";

function formatClock(seconds: number) {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function MobileRecorder() {
	const [phase, setPhase] = useState<Phase>("closed");
	const [mic, setMic] = useState(true);
	const [seconds, setSeconds] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const timer = useRef<number>();

	useEffect(() => {
		const open = () => {
			setError(null);
			setPhase((current) => (current === "closed" ? "idle" : current));
		};
		window.addEventListener(OPEN_RECORDER_EVENT, open);
		// Resume the UI if the WebView was recreated while the service kept recording.
		if (isNativeAndroid()) {
			void ScreenRecorder.isRecording().then(({ recording }) => {
				if (recording) setPhase("recording");
			});
		}
		return () => window.removeEventListener(OPEN_RECORDER_EVENT, open);
	}, []);

	useEffect(() => {
		if (phase !== "recording") return;
		setSeconds(0);
		timer.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);
		return () => window.clearInterval(timer.current);
	}, [phase]);

	const start = useCallback(async () => {
		setError(null);
		setPhase("starting");
		try {
			await ScreenRecorder.start({ audio: mic });
			setPhase("recording");
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setPhase("idle");
		}
	}, [mic]);

	const stop = useCallback(async () => {
		setPhase("saving");
		try {
			const { path } = await ScreenRecorder.stop();
			await storeRecording(path);
			location.replace("?windowType=editor&startupView=editor");
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setPhase("idle");
		}
	}, []);

	if (phase === "closed") return null;
	const busy = phase === "starting" || phase === "saving";

	// Portal to <body> with a top z-index: the dashboard modal sits at z-index 100000
	// and marks everything outside it inert (react-aria), which blocks every tap here.
	// data-react-aria-top-layer exempts this sheet from that.
	return createPortal(
		<div
			data-react-aria-top-layer="true"
			className="fixed inset-0 flex items-end bg-black/50"
			style={{ zIndex: 2147483647, pointerEvents: "auto", touchAction: "manipulation" }}
			onClick={() => phase === "idle" && setPhase("closed")}
		>
			<div
				className="w-full rounded-t-3xl bg-[var(--card,#202023)] p-6 text-[var(--foreground,#eee)] shadow-2xl"
				style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
				onClick={(event) => event.stopPropagation()}
			>
				<h2 className="text-lg font-semibold">
					{phase === "recording"
						? "Recording"
						: phase === "saving"
							? "Saving…"
							: "Record your screen"}
				</h2>
				{phase === "recording" ? (
					<p className="mt-2 font-mono text-4xl tabular-nums">{formatClock(seconds)}</p>
				) : (
					<p className="mt-1 text-sm opacity-70">
						Everything is recorded and stored on this phone.
					</p>
				)}
				{phase === "idle" && (
					<label className="mt-4 flex min-h-12 items-center gap-3 text-base">
						<input
							type="checkbox"
							className="size-5"
							checked={mic}
							onChange={(event) => setMic(event.target.checked)}
						/>
						Record microphone
					</label>
				)}
				{error && <p className="mt-3 text-sm text-red-400">{error}</p>}
				<div className="mt-5 flex gap-3">
					{phase === "recording" ? (
						<button
							type="button"
							className="h-14 flex-1 rounded-2xl bg-red-600 text-base font-semibold text-white"
							onClick={() => void stop()}
						>
							Stop & edit
						</button>
					) : (
						<>
							<button
								type="button"
								disabled={busy}
								className="h-14 flex-1 rounded-2xl bg-red-600 text-base font-semibold text-white disabled:opacity-50"
								onClick={() => void start()}
							>
								{busy ? "Please wait…" : "Start recording"}
							</button>
							<button
								type="button"
								disabled={busy}
								className="h-14 rounded-2xl bg-white/10 px-5 text-base disabled:opacity-50"
								onClick={() => setPhase("closed")}
							>
								Cancel
							</button>
						</>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}
