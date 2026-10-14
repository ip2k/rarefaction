/// Double one input sample.
pub fn scale(value: i32) -> i32 {
    value * 2
}
pub fn render(value: i32) -> i32 {
    scale(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_scale() {
        assert_eq!(render(3), 6);
    }
}
