import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cockpit = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
const cockpitStyles = readFileSync(new URL("../components/cockpit/Cockpit.module.css", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../manifest.ts", import.meta.url), "utf8");
const layout = readFileSync(new URL("../layout.tsx", import.meta.url), "utf8");
const signUp = readFileSync(new URL("../auth/sign-up/page.tsx", import.meta.url), "utf8");

function pngSize(path) {
  const png = readFileSync(new URL(path, import.meta.url));
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function pngHasAlpha(path) {
  const png = readFileSync(new URL(path, import.meta.url));
  return [4, 6].includes(png[25]);
}

test("le logo account est réservé à l'accueil initial et à la création de compte", () => {
  assert.match(signUp, /src="\/branding\/balloon-companion-logo-account\.png"/);
  assert.match(cockpit, /if \(choicePending\)[\s\S]*src="\/branding\/balloon-companion-logo-account\.png"[\s\S]*<h1>Bienvenue<\/h1>/);
  assert.equal(cockpit.match(/balloon-companion-logo-account\.png/g)?.length, 1);
  assert.doesNotMatch(manifest, /balloon-companion-logo-(?:account|cockpit)\.png/);
  assert.match(cockpitStyles, /\.welcomeLogo \{[^}]*width: min\(86vw, 390px\);[^}]*height: auto;[^}]*object-fit: contain;/s);
  assert.match(cockpitStyles, /grid-template-rows: minmax\(0, 1fr\) auto auto/);
  assert.match(cockpitStyles, /font-size: clamp\(34px, 8\.5vw, 40px\)/);
  assert.equal(cockpitStyles.match(/translateY\(clamp\(-24px, -3dvh, -16px\)\)/g)?.length, 2);
});

test("le logo Cockpit est réservé au header Cockpit", () => {
  const asset = readFileSync(new URL("../../public/branding/balloon-companion-logo-cockpit.png", import.meta.url));
  assert.ok(asset.length > 0);
  assert.match(cockpit, /<header className=\{styles\.header\}>[\s\S]*src="\/branding\/balloon-companion-logo-cockpit\.png"[\s\S]*Bonjour/);
  assert.equal(cockpit.match(/balloon-companion-logo-cockpit\.png/g)?.length, 1);
  assert.doesNotMatch(signUp, /balloon-companion-logo-cockpit\.png/);
  assert.doesNotMatch(manifest, /balloon-companion-logo-cockpit\.png/);
  assert.match(cockpitStyles, /\.cockpitLogo \{[^}]*width: clamp\(150px, 40vw, 180px\);[^}]*height: auto;[^}]*object-fit: contain;/s);
  assert.match(cockpitStyles, /\.header \{[^}]*height: clamp\(56px, 15\.1vw, 69px\);[^}]*align-items: center;/s);
  assert.doesNotMatch(cockpitStyles.match(/\.welcome \{[^}]*\}/s)?.[0] ?? "", /text-overflow: ellipsis/);
});

test("la PWA, Apple Touch Icon et le favicon utilisent la nouvelle identité", () => {
  assert.deepEqual(pngSize("../../public/branding/balloon-companion-icon-pwa.png"), { width: 1024, height: 1024 });
  assert.deepEqual(pngSize("../../public/branding/balloon-companion-icon-pwa-192.png"), { width: 192, height: 192 });
  assert.deepEqual(pngSize("../../public/branding/balloon-companion-icon-pwa-512.png"), { width: 512, height: 512 });
  assert.deepEqual(pngSize("../../app/apple-icon.png"), { width: 180, height: 180 });
  assert.deepEqual(pngSize("../../app/icon.png"), { width: 32, height: 32 });
  assert.equal(pngHasAlpha("../../app/apple-icon.png"), false);
  assert.equal(pngHasAlpha("../../public/branding/balloon-companion-icon-pwa-192.png"), false);
  assert.equal(pngHasAlpha("../../public/branding/balloon-companion-icon-pwa-512.png"), false);
  assert.match(manifest, /balloon-companion-icon-pwa-192\.png[\s\S]*sizes: "192x192"[\s\S]*purpose: "any"/);
  assert.match(manifest, /balloon-companion-icon-pwa-512\.png[\s\S]*sizes: "512x512"[\s\S]*purpose: "any"/);
  assert.doesNotMatch(`${manifest}\n${layout}`, /balloon-companion-logo-(?:account|cockpit)\.png/);
  assert.doesNotMatch(manifest, /purpose: "maskable"/);
});
