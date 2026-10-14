public protocol Shape {
    func area() -> Double
}

public struct Square: Shape {
    public let side: Double
    public init(side: Double) { self.side = side }
    public func area() -> Double { side * side }
}

public struct Circle: Shape {
    public let radius: Double
    public init(radius: Double) { self.radius = radius }
    public func area() -> Double { 3.14159 * radius * radius }
}

public func totalArea(_ shapes: [any Shape]) -> Double {
    shapes.reduce(0) { $0 + $1.area() }
}
