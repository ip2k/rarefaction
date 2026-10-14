public struct Recorder {
    public init() {}

    public func record(_ value: Int) -> Int {
        var engine = Engine()
        engine.updateLocation(value)
        return engine.score()
    }
}
