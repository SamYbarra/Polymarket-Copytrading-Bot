import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
export default defineConfig({
    plugins: [react()],
    server: { port: 3005 },
    preview: { port: 3005 },
    resolve: {
        alias: { "@": path.resolve(__dirname, "src") },
    },
});
