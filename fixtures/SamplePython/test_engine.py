from render import render
from engine import scale


def test_scale():
    assert scale(3) == 6
    assert render(3) == 6
