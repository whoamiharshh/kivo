/**
 * The registry has to tell the truth about what is on disk.
 *
 * `built: true` next to a screen that does not exist puts a 404 on the home
 * screen, which is the bug this registry was created to end. `built: false`
 * next to a screen that *does* exist quietly hides finished work. Both are
 * caught here, against the real filesystem, where the source tree exists.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_ROUTES } from "./routes";

const APP_DIR = join(process.cwd(), "app", "(app)");

/** Does `app/(app)/<href>/page.tsx` exist? */
function screenExists(href: string): boolean {
  return existsSync(join(APP_DIR, href.replace(/^\//, ""), "page.tsx"));
}

describe("feature route registry", () => {
  it("has the app directory where it expects it", () => {
    expect(existsSync(APP_DIR)).toBe(true);
  });

  for (const route of FEATURE_ROUTES) {
    it(`${route.href}: built=${route.built} matches the filesystem`, () => {
      expect(screenExists(route.href)).toBe(route.built);
    });
  }

  it("lists every real screen, so none is silently unreachable", () => {
    // Dynamic segments and the catch-all are not features; the home screen and
    // create/join belong to pots, which is the home screen itself.
    const notFeatures = new Set(["pot", "create", "join"]);

    const onDisk = readdirSync(APP_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => !name.startsWith("[") && !notFeatures.has(name))
      .filter((name) => existsSync(join(APP_DIR, name, "page.tsx")));

    const registered = new Set(
      FEATURE_ROUTES.map((r) => r.href.replace(/^\//, ""))
    );

    const missing = onDisk.filter((name) => !registered.has(name));
    expect(missing).toEqual([]);
  });

  it("points every route at a path, not a bare label", () => {
    for (const route of FEATURE_ROUTES) {
      expect(route.href.startsWith("/")).toBe(true);
      expect(route.label.trim().length).toBeGreaterThan(0);
    }
  });
});
