/// Accumulates a location and scores it.
public struct Engine {
    public var location: Int = 0

    public init() {}

    /// Record the latest location.
    ///
    /// Called from the recorder, the replayer, and the tests.
    public mutating func updateLocation(_ value: Int) {
        location = value
    }

    public func score() -> Int {
        location * 2
    }
}
