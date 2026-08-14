import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cockpit = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../manifest.ts", import.meta.url), "utf8");
const signUp = readFileSync(new URL("../auth/sign-up/page.tsx", import.meta.url), "utf8");

test("le logo account est réservé à l'accueil initial et à la création de compte", () => {
  assert.match(signUp, /src="\/branding\/balloon-companion-logo-account\.png"/);
  assert.match(cockpit, /if \(choicePending\)[\s\S]*src="\/branding\/balloon-companion-logo-account\.png"[\s\S]*<h1>Bienvenue<\/h1>/);
  assert.equal(cockpit.match(/balloon-companion-logo-account\.png/g)?.length, 1);
  assert.doesNotMatch(manifest, /\/branding\//);
});
