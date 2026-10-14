public func replay(_ values: [Int]) -> [Int] {
    var engine = Engine()
    return values.map { value in
        engine.updateLocation(value)
        return engine.score()
    }
}
