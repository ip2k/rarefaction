/// Double one input sample.
pub fn scale(value: i32) -> i32 {
    value * 2
}

/// Scale twice; a caller inside the same crate.
pub fn twice(value: i32) -> i32 {
    scale(scale(value))
}
