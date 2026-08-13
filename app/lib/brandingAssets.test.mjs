import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const digest = (path) => createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex");
const cockpit = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../manifest.ts", import.meta.url), "utf8");

test("le Cockpit et le premier lancement utilisent les logos officiels", () => {
  assert.match(cockpit, /balloon-companion-logo-marine-fond-bleu\.png/);
  assert.match(cockpit, /balloon-companion-logo-principal-horizontal\.png/);
  assert.doesNotMatch(cockpit, /import appIcon/);
});

test("la PWA et les metadata utilisent les assets officiels sans altération", () => {
  assert.match(manifest, /balloon-companion-icone-app\.png/);
  assert.doesNotMatch(manifest, /purpose: "maskable"/);
  assert.equal(digest("../../app/apple-icon.png"), digest("../../public/branding/balloon-companion-icone-app.png"));
  assert.equal(digest("../../app/icon.png"), digest("../../public/branding/balloon-companion-symbole-bc-seul.png"));
});
