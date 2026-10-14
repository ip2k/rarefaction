import { describe, expect, it } from "vitest";
import { bareName, parseSymbolQuery } from "../../src/graph/symbols.js";

describe("parseSymbolQuery", () => {
  it("accepts Rust qualified symbols and WAT dollar names", () => {
    expect(parseSymbolQuery("engine::scale")).toEqual({ kind: "name", container: "engine", name: "scale" });
    expect(bareName("engine::scale")).toBe("scale");
    expect(bareName("$scale")).toBe("scale");
  });
  it("reads a bare name", () => {
    expect(parseSymbolQuery("updateLocation")).toEqual({ kind: "name", name: "updateLocation" });
  });
  it("splits a qualified name into container and name", () => {
    expect(parseSymbolQuery("Engine.updateLocation")).toEqual({
      kind: "name",
      name: "updateLocation",
      container: "Engine",
    });
  });
  it("ignores an argument list", () => {
    expect(parseSymbolQuery("Engine.updateLocation(_:)")).toEqual({
      kind: "name",
      name: "updateLocation",
      container: "Engine",
    });
  });
  it("keeps nested containers intact", () => {
    expect(parseSymbolQuery("A.B.c")).toEqual({ kind: "name", name: "c", container: "A.B" });
  });
  it("reads an editor position as 1-based line:column", () => {
    expect(parseSymbolQuery("Sources/Engine.swift:204:10")).toEqual({
      kind: "position",
      file: "Sources/Engine.swift",
      line: 204,
      character: 10,
    });
  });
  it("does not mistake a Windows-ish or dotted path for a name", () => {
    expect(parseSymbolQuery("App/Trip+Crop.swift:19:5").kind).toBe("position");
  });
});

describe("bareName", () => {
  it("strips argument labels and containers the way servers spell names", () => {
    expect(bareName("updateLocation(_:)")).toBe("updateLocation");
    expect(bareName("Engine.updateLocation(_:)")).toBe("updateLocation");
    expect(bareName("init(x:y:)")).toBe("init");
    expect(bareName("score")).toBe("score");
  });
});
