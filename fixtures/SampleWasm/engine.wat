(module
  (func $scale (param $value i32) (result i32)
    local.get $value
    i32.const 2
    i32.mul)
  (func $render (param $value i32) (result i32)
    local.get $value
    call $scale)
  (export "render" (func $render)))
