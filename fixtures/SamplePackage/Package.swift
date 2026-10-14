// swift-tools-version: 5.9
// A deliberately tiny package with cross-file callers, a protocol with two
// conformers, and a test target whose test case reaches the code through a
// helper — the shapes `orient` has to get right.
import PackageDescription

let package = Package(
    name: "Sample",
    targets: [
        .target(name: "Sample"),
        .testTarget(name: "SampleTests", dependencies: ["Sample"]),
    ]
)
