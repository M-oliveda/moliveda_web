// @vitest-environment node
import { describe, expect, it } from "vitest";

import { loadMessages } from "@/i18n/messages";
import { LOCALES } from "@/i18n/routing";

// Parity (MASTERPLAN 4.4): every locale has exactly the English keys, and no
// value is empty.
function flatten(node: unknown, prefix = ""): Map<string, unknown> {
  const entries = new Map<string, unknown>();
  if (typeof node !== "object" || node === null) {
    entries.set(prefix, node);
    return entries;
  }
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    for (const [leaf, leafValue] of flatten(value, path)) {
      entries.set(leaf, leafValue);
    }
  }
  return entries;
}

describe("loadMessages", () => {
  it("merges one namespace per file", async () => {
    const messages = await loadMessages("en");

    expect(Object.keys(messages)).toStrictEqual(["UI", "Metadata"]);
    expect(messages.Metadata.title).toBe("Mauricio Oliveda");
  });

  it("loads the requested locale", async () => {
    const messages = await loadMessages("fr");

    expect(messages.UI.nav.about).toBe("À propos");
  });

  describe.each(LOCALES)("%s", (locale) => {
    it("has exactly the English keys", async () => {
      const reference = flatten(await loadMessages("en"));
      const actual = flatten(await loadMessages(locale));

      expect([...actual.keys()].sort()).toStrictEqual(
        [...reference.keys()].sort()
      );
    });

    it("has only non-empty strings", async () => {
      const values = [...flatten(await loadMessages(locale)).entries()];

      const invalid = values.filter(
        ([, value]) => typeof value !== "string" || value.trim() === ""
      );

      expect(invalid).toStrictEqual([]);
    });
  });
});
