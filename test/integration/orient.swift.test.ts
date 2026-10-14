// Runs the real sourcekit-lsp against fixtures/SamplePackage. Skipped when no
// Swift toolchain is present, so `npm test` stays green on a Linux CI box.

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { swiftProfile } from "../../src/profiles/swift.js";
import { Session } from "../../src/session.js";
import { orient, type OrientOutputType } from "../../src/tools/orient.js";

const execFileP = promisify(execFile);
const FIXTURE = resolve(import.meta.dirname, "..", "..", "fixtures", "SamplePackage");

async function haveSwift(): Promise<boolean> {
  try {
    await execFileP("xcrun", ["--find", "sourcekit-lsp"]);
    return true;
  } catch {
    return false;
  }
}

const swift = await haveSwift();

describe.skipIf(!swift)("orient on a SwiftPM package", () => {
  let session: Session;
  let result: OrientOutputType;

  beforeAll(async () => {
    // A build populates the index store sourcekit-lsp reads for call hierarchy.
    await execFileP("swift", ["build", "--build-tests"], { cwd: FIXTURE, timeout: 300_000 });
    session = new Session(FIXTURE, swiftProfile);
    result = await orient(session, { symbol: "Engine.updateLocation", up: 2, down: 1, max_nodes: 50, include_body: true, max_body_lines: 80 });
  }, 400_000);

  afterAll(async () => {
    await session?.close();
  });

  it("finds the declaration, its doc, and its whole body", () => {
    expect(result.symbol.file).toBe("Sources/Sample/Engine.swift");
    expect(result.symbol.callable).toBe(true);
    expect(result.symbol.signature).toContain("func updateLocation(_ value: Int)");
    expect(result.symbol.doc).toContain("Record the latest location");
    expect(result.body?.text).toContain("location = value");
    expect(result.body!.end_line - result.body!.start_line).toBeGreaterThanOrEqual(2);
  });

  it("lists cross-file callers with call-site lines", () => {
    const names = result.callers.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Recorder.record(_:)", "replay(_:)", "EngineTests.makeEngine(_:)"]));
    const record = result.callers.find((c) => c.name === "Recorder.record(_:)")!;
    expect(record.file).toBe("Sources/Sample/Recorder.swift");
    expect(record.call_sites).toEqual([6]);
    expect(record.depth).toBe(1);
  });

  it("tells a test case from a test helper, and reaches the case through the helper", () => {
    const helper = result.callers.find((c) => c.name === "EngineTests.makeEngine(_:)")!;
    expect(helper.is_test_file).toBe(true);
    expect(helper.is_test_case).toBe(false);
    const testCase = result.callers.find((c) => c.name === "EngineTests.testScoreDoublesLocation()")!;
    expect(testCase.depth).toBe(2);
    expect(testCase.is_test_case).toBe(true);
    expect(result.test_run_hint?.command).toContain("EngineTests");
  });

  it("keeps the live set to the files that matter", () => {
    expect(result.live_files).toEqual([
      "Sources/Sample/Engine.swift",
      "Sources/Sample/Recorder.swift",
      "Sources/Sample/Replay.swift",
      "Tests/SampleTests/EngineTests.swift",
    ]);
    expect(result.project_source_files).toBe(6); // four sources, one test, Package.swift
  });

  it("reports SwiftPM as an on-open index", () => {
    expect(result.freshness.model).toBe("on-open");
  });

  it("resolves a protocol requirement to its conformers", async () => {
    const r = await orient(session, { symbol: "Shape.area", up: 1, down: 0, max_nodes: 50, include_body: false, max_body_lines: 0 });
    expect(r.implementations.map((i) => i.file)).toEqual(["Sources/Sample/Shape.swift", "Sources/Sample/Shape.swift"]);
  });

  it("explains an ambiguous name with exact positions", async () => {
    await expect(orient(session, { symbol: "area", up: 1, down: 0, max_nodes: 50, include_body: false, max_body_lines: 0 })).rejects.toThrow(
      /ambiguous.*Shape\.swift:\d+:\d+/s,
    );
  });
});
