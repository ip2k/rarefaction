import XCTest
@testable import Sample

final class EngineTests: XCTestCase {
    /// A helper: reaches `updateLocation` directly, but is not itself a test.
    func makeEngine(_ value: Int) -> Engine {
        var engine = Engine()
        engine.updateLocation(value)
        return engine
    }

    func testScoreDoublesLocation() {
        XCTAssertEqual(makeEngine(3).score(), 6)
    }

    func testReplayScoresEveryValue() {
        XCTAssertEqual(replay([1, 2]), [2, 4])
    }
}
