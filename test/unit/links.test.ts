import { describe, expect, it } from "vitest";
import { configKeys, configLinks, testLinks } from "../../src/graph/links.js";
import { pythonProfile } from "../../src/profiles/python.js";
import { rustProfile } from "../../src/profiles/rust.js";
import { typescriptProfile } from "../../src/profiles/typescript.js";

describe("links a language server does not report", () => {
  it("links code to the tests named for it, and tests to their code", () => {
    const project = ["src/engine.ts", "src/engine.test.ts", "test/engine.spec.ts", "src/other.ts", "src/other.test.ts"];
    expect(testLinks(typescriptProfile, ["src/engine.ts"], project).map((l) => l.file)).toEqual(["src/engine.test.ts", "test/engine.spec.ts"]);
    expect(testLinks(typescriptProfile, ["src/other.test.ts"], project).map((l) => l.file)).toEqual(["src/other.ts"]);
    expect(testLinks(pythonProfile, ["httpx/_client.py"], ["httpx/_client.py", "tests/test__client.py"]).map((l) => l.file)).toEqual(["tests/test__client.py"]);
    expect(testLinks(rustProfile, ["src/flags.rs"], ["src/flags.rs", "tests/flags.rs", "tests/misc/flags.rs"]).map((l) => l.file)).toEqual(["tests/flags.rs"]);
  });

  it("takes key-shaped string literals of 4–40 characters with a separator", () => {
    const body = `let a = "max-count"; let b = "hello"; let c = 'dotted.key'; let d = "x_y"; let e = "has space-in"; let f = "max-count";`;
    expect(configKeys(rustProfile, body)).toEqual(["max-count"]);
    expect(configKeys(pythonProfile, body)).toEqual(["max-count", "dotted.key"]);
  });

  it("links files sharing a key, skipping keys found in more than five other files", () => {
    const texts = new Map([
      ["seed.rs", `"max-count" "common_key"`], ["flags.rs", `"max-count"`],
      ...Array.from({ length: 6 }, (_, i) => [`f${i}.rs`, "common_key"] as [string, string]),
    ]);
    expect(configLinks(["max-count", "common_key"], "seed.rs", texts)).toEqual([{ file: "flags.rs", reason: `shares key "max-count"` }]);
  });
});
