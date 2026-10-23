import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const mediaRoot = "https://moejay.github.io/pi-secure/media/";

test("gallery previews use public Pages URLs with real, bounded assets", async () => {
  assert.equal(manifest.pi.image, `${mediaRoot}preview.png`);
  assert.equal(manifest.pi.video, `${mediaRoot}demo.mp4`);
  assert.ok(manifest.keywords.includes("pi-package"));
  for (const name of ["preview.png", "demo.mp4", "demo.vtt", "demo-transcript.md"]) {
    const info = await stat(new URL(`docs/media/${name}`, root));
    assert.ok(info.size > 0, `${name} must not be empty`);
    assert.ok(info.size < 10 * 1024 * 1024, `${name} must stay under 10 MiB`);
  }
});

test("preview is a PNG and video uses an MP4 container", async () => {
  const png = await readFile(new URL("docs/media/preview.png", root));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1280);
  assert.equal(png.readUInt32BE(20), 800);
  const mp4 = await readFile(new URL("docs/media/demo.mp4", root));
  assert.equal(mp4.subarray(4, 8).toString(), "ftyp");
});

test("website video is opt-in and captioned, with a separate text transcript", async () => {
  const html = await readFile(new URL("docs/index.html", root), "utf8");
  const video = html.match(/<video\b[^>]*>/)?.[0];
  assert.ok(video);
  assert.match(video, /\bcontrols\b/);
  assert.match(video, /\bpreload="none"/);
  assert.doesNotMatch(video, /\bautoplay\b/);
  assert.match(html, /src="\.\/media\/demo\.vtt(?:\?[^"]+)?" kind="captions"/);
  const transcript = await readFile(new URL("docs/media/demo-transcript.md", root), "utf8");
  assert.ok(transcript.length > 100);
  const captions = await readFile(new URL("docs/media/demo.vtt", root), "utf8");
  assert.match(captions, /^WEBVTT/);
});
