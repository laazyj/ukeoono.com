// Fetch the YouTube thumbnail for every `video:` in the back catalogue, once,
// into static/back-catalogue/<entry>/videos/<id>.jpg. Run by hand after adding
// videos (`npm run thumbs -w @uke-o-ono/site`) and commit the images: the site
// serves them itself, so visitors never load anything from YouTube.
import { Buffer } from "node:buffer";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const site = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const content = path.join(site, "content/back-catalogue");

const exists = (file) =>
  stat(file).then(
    () => true,
    () => false,
  );

let fetched = 0;
for (const name of await readdir(content)) {
  if (!name.endsWith(".md")) continue;
  const slug = name.slice(0, -3);
  const dir = path.join(site, "static/back-catalogue", slug, "videos");
  const { data } = matter(await readFile(path.join(content, name), "utf8"));
  const ids = [...(data.setlist ?? []), ...(data.extras ?? [])].map((s) => s.video).filter(Boolean);
  for (const id of new Set(ids)) {
    const out = path.join(dir, `${id}.jpg`);
    if (await exists(out)) continue;
    // mqdefault is 320x180, true 16:9 with no letterbox bars.
    const res = await fetch(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
    if (!res.ok) throw new Error(`${slug}: no thumbnail for ${id} (HTTP ${res.status})`);
    await mkdir(dir, { recursive: true });
    await writeFile(out, Buffer.from(await res.arrayBuffer()));
    console.log(`${slug}: fetched ${id}`);
    fetched++;
  }
}
console.log(fetched ? `Fetched ${fetched} thumbnail(s).` : "All thumbnails present.");
