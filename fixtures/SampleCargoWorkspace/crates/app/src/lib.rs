/// Format a scaled sample; a caller in a sibling crate.
pub fn render(value: i32) -> String {
    sample_core::scale(value).to_string()
}
