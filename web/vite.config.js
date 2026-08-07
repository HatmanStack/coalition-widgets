import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* The site. Pages only — the widgets themselves are served by the CloudFront distribution, and
 * this app loads them from there exactly as a partner's site will.
 *
 * `fs.allow` reaches one level up because the prose these pages render is imported from
 * ../embed/content.mjs, which is also what generates llm.txt. Two renderings, one source: a
 * widget table restated by hand here would be wrong the first time a widget was added, and a
 * documentation table is where drift does the most damage.
 */
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [".."] } },
});
