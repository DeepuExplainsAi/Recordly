import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	cacheDir: "/opt/vite-cache",
	plugins: [react()],
	resolve: {
		alias: {
			"@radix-ui/primitive/is-development": path.resolve(__dirname, "src/mobile/is-development.ts"),
			"@": path.resolve(__dirname, "src"),
		},
	},
	build: {
		outDir: "dist-mobile",
		target: "es2022",
		minify: "esbuild",
		reportCompressedSize: false,
		sourcemap: false,
		chunkSizeWarningLimit: 3000,
		rollupOptions: { input: path.resolve(__dirname, "index.html") },
	},
});
