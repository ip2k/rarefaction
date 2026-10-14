#!/usr/bin/env python3
"""Render the README diagrams as SVG in Rosé Pine Dawn (light) and Moon (dark).

    python3 tools/render_diagrams.py   # writes docs/images/*.svg

The README picks the variant with <picture> and prefers-color-scheme, which
GitHub resolves against the reader's theme. Palette values are from
https://github.com/rose-pine/palette (palette.json).
"""

from pathlib import Path
from xml.sax.saxutils import escape

PALETTES = {
    "dawn": dict(base="#faf4ed", surface="#fffaf3", overlay="#f2e9e1", muted="#9893a5", subtle="#797593",
                 text="#464261", love="#b4637a", gold="#ea9d34", rose="#d7827e", pine="#286983",
                 foam="#56949f", iris="#907aa9"),
    "moon": dict(base="#232136", surface="#2a273f", overlay="#393552", muted="#6e6a86", subtle="#908caa",
                 text="#e0def4", love="#eb6f92", gold="#f6c177", rose="#ea9a97", pine="#3e8fb0",
                 foam="#9ccfd8", iris="#c4a7e7"),
}

SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
OUT = Path(__file__).resolve().parent.parent / "docs" / "images"


def text(x, y, s, c, size=13, weight=400, mono=False, anchor="start", opacity=None):
    font = MONO if mono else SANS
    op = f' opacity="{opacity}"' if opacity else ""
    return (f'<text x="{x}" y="{y}" fill="{c}" font-family="{font}" font-size="{size}" '
            f'font-weight="{weight}" text-anchor="{anchor}"{op}>{escape(s)}</text>')


def rect(x, y, w, h, fill, stroke=None, sw=1, r=10, dash=None):
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{s}{d}/>'


def arrow_defs(p):
    out = ["<defs>"]
    for name in ("gold", "pine", "foam", "muted", "subtle"):
        out.append(f'<marker id="a-{name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
                   f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{p[name]}"/></marker>')
    out.append("</defs>")
    return "".join(out)


def line(p, x1, y1, x2, y2, c, sw=2, both=False):
    ms = f' marker-start="url(#a-{c})"' if both else ""
    return (f'<path d="M{x1},{y1} L{x2},{y2}" stroke="{p[c]}" stroke-width="{sw}" fill="none" '
            f'marker-end="url(#a-{c})"{ms}/>')


def svg(w, h, title, desc, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" '
            f'aria-labelledby="t d"><title id="t">{escape(title)}</title><desc id="d">{escape(desc)}</desc>{body}</svg>\n')


def architecture(p):
    W, H = 960, 452
    b = [arrow_defs(p), rect(0.5, 0.5, W - 1, H - 1, p["base"], p["overlay"], 1, 18)]
    b.append(text(32, 42, "How Rarefaction works", p["text"], 20, 700))
    b.append(text(32, 64, "One MCP call in, a bounded answer out — composed from the language server's own index.",
                  p["subtle"], 13))

    # Agent
    b.append(rect(32, 150, 180, 150, p["surface"], p["muted"], 1.5, 14))
    b.append(text(122, 182, "Coding agent", p["text"], 16, 700, anchor="middle"))
    for i, s in enumerate(("Claude Code", "Codex", "any MCP client")):
        b.append(text(122, 214 + i * 24, s, p["subtle"], 13, anchor="middle"))

    # Agent <-> Rarefaction
    b.append(line(p, 216, 196, 296, 196, "gold"))
    b.append(text(256, 186, "orient(…)", p["gold"], 11, 600, mono=True, anchor="middle"))
    b.append(line(p, 296, 262, 216, 262, "pine"))
    b.append(text(256, 284, "one answer", p["pine"], 11, 600, anchor="middle"))
    b.append(text(256, 230, "MCP · stdio", p["muted"], 10, 600, anchor="middle"))

    # Rarefaction core
    b.append(rect(300, 84, 340, 334, p["surface"], p["rose"], 2, 16))
    b.append(text(320, 114, "Rarefaction", p["love"], 17, 700))
    b.append(text(620, 114, "MCP server", p["muted"], 12, anchor="end"))
    steps = [
        ("1", "Workspace router", "picks the profile and project", "pine"),
        ("2", "Symbol resolver", "name or path:line:col → exact position", "foam"),
        ("3", "Graph walk", "callers ↑2, callees ↓1, deduped, capped", "iris"),
        ("4", "Renderer", "bounded Markdown + structured JSON", "gold"),
    ]
    for i, (n, title, desc, c) in enumerate(steps):
        y = 128 + i * 62
        b.append(rect(320, y, 300, 50, p["overlay"], None, 0, 10))
        b.append(f'<circle cx="343" cy="{y + 25}" r="11" fill="{p[c]}"/>')
        b.append(text(343, y + 29.5, n, p["base"], 12, 700, anchor="middle"))
        b.append(text(364, y + 21, title, p["text"], 14, 700))
        b.append(text(364, y + 39, desc, p["subtle"], 12))
        if i < 3:
            b.append(f'<path d="M470,{y + 51} L470,{y + 61}" stroke="{p["muted"]}" stroke-width="1.5"/>')
    b.append(rect(320, 378, 300, 26, p["base"], p["iris"], 1, 13, dash="4 3"))
    b.append(text(470, 395, "profiles: launch · prerequisites · tests · freshness", p["iris"], 11, 600, anchor="middle"))

    # Rarefaction <-> language servers
    b.append(line(p, 644, 251, 704, 251, "foam", both=True))
    b.append(text(674, 241, "LSP", p["foam"], 11, 700, anchor="middle"))
    b.append(text(674, 271, "stdio", p["muted"], 10, 600, anchor="middle"))

    # Language servers
    b.append(rect(708, 84, 220, 334, p["surface"], p["muted"], 1.5, 16))
    b.append(text(728, 114, "Language servers", p["text"], 15, 700))
    servers = [("Swift", "sourcekit-lsp", "love"), ("Rust", "rust-analyzer", "gold"), ("C / C++", "clangd", "rose"),
               ("TS / JS", "typescript-language-server", "pine"), ("Python", "pyright", "foam"),
               ("WAT", "wat_server", "iris")]
    for i, (lang, srv, c) in enumerate(servers):
        y = 128 + i * 46
        b.append(rect(724, y, 188, 38, p["overlay"], None, 0, 9))
        b.append(f'<rect x="724" y="{y}" width="5" height="38" rx="2.5" fill="{p[c]}"/>')
        b.append(text(738, y + 16, lang, p[c], 12, 700))
        b.append(text(738, y + 31, srv, p["subtle"], 10.5, mono=True))

    b.append(text(480, 440, "callHierarchy · references · implementation · typeHierarchy — answered from each project's "
                  "own index (Xcode/SwiftPM, Cargo, compile_commands.json, tsconfig, pyright)",
                  p["muted"], 11, anchor="middle"))
    return svg(W, H, "How Rarefaction works",
               "A coding agent calls orient over MCP; Rarefaction routes the request to a language profile, resolves "
               "the symbol, walks the call graph through the language server over LSP and returns one bounded answer.",
               "".join(b))


def node(p, x, y, w, name, where, accent, badge=None, helper=False, focus=False):
    h = 50
    stroke, sw = (p["gold"], 2.5) if focus else (p[accent], 1.5)
    out = [rect(x, y, w, h, p["surface"], stroke, sw, 10)]
    out.append(text(x + 12, y + 21, name, p["text"], 13, 700, mono=True))
    out.append(text(x + 12, y + 39, where, p["subtle"], 11, mono=True))
    if badge:
        bw = 8 + 7 * len(badge)
        out.append(rect(x + w - bw - 8, y + 8, bw, 18, p[accent], None, 0, 9))
        out.append(text(x + w - 8 - bw / 2, y + 21, badge, p["base"], 10, 700, anchor="middle"))
    return "".join(out)


def orient(p):
    W, H = 960, 470
    b = [arrow_defs(p), rect(0.5, 0.5, W - 1, H - 1, p["base"], p["overlay"], 1, 18)]
    b.append(text(32, 42, "What one orient call returns", p["text"], 20, 700))
    b.append(text(32, 64, 'orient { symbol: "Engine.updateLocation" } on fixtures/SamplePackage (Swift)',
                  p["subtle"], 13, mono=True))

    # Level labels
    for y, s in ((112, "callers · depth 2"), (212, "callers · depth 1"), (312, "the symbol")):
        b.append(text(32, y, s, p["muted"], 11, 700))

    # Depth 2 (tests)
    b.append(node(p, 32, 120, 292, "testReplayScoresEveryValue()", "EngineTests.swift", "pine", "test"))
    b.append(node(p, 340, 120, 286, "testScoreDoublesLocation()", "EngineTests.swift", "pine", "test"))

    # Depth 1
    c1 = (32, 220, 176)
    c2 = (226, 220, 176)
    c3 = (420, 220, 206)
    b.append(node(p, c1[0], c1[1], c1[2], "Recorder.record(_:)", "Recorder.swift:6", "muted"))
    b.append(node(p, c2[0], c2[1], c2[2], "replay(_:)", "Replay.swift:4", "muted"))
    b.append(node(p, c3[0], c3[1], c3[2], "makeEngine(_:)", "EngineTests.swift:8", "iris", "helper"))

    # Focus
    f = (190, 320, 300)
    b.append(node(p, f[0], f[1], f[2], "Engine.updateLocation(_:)", "Engine.swift:10 · body + doc", "gold", focus=True))
    b.append(text(340, 398, "callees: none in the project (SDK calls are counted, not listed)", p["muted"], 11,
                  anchor="middle"))

    def edge(x1, y1, x2, y2, c="subtle"):
        return line(p, x1, y1, x2, y2, c, 1.5)

    b.append(edge(240, 171, 300, 218))      # testReplay -> replay
    b.append(edge(483, 171, 513, 218))      # testScore -> makeEngine
    b.append(edge(120, 271, 270, 318))      # record -> focus
    b.append(edge(314, 271, 340, 318))      # replay -> focus
    b.append(edge(523, 271, 420, 318))      # makeEngine -> focus

    # Right panel
    x0 = 652
    b.append(rect(x0, 92, 276, 150, p["surface"], p["pine"], 1.5, 14))
    b.append(text(x0 + 16, 118, "Tests that reach it (2)", p["pine"], 14, 700))
    b.append(text(x0 + 16, 142, "testScoreDoublesLocation", p["text"], 12, mono=True))
    b.append(text(x0 + 16, 162, "testReplayScoresEveryValue", p["text"], 12, mono=True))
    b.append(rect(x0 + 14, 176, 248, 50, p["overlay"], None, 0, 8))
    b.append(text(x0 + 24, 196, "run only these (SwiftPM):", p["muted"], 11, 600))
    b.append(text(x0 + 24, 215, "swift test --filter EngineTests", p["text"], 11.5, mono=True))

    b.append(rect(x0, 256, 276, 168, p["surface"], p["iris"], 1.5, 14))
    b.append(text(x0 + 16, 282, "Live files (4 of 6)", p["iris"], 14, 700))
    for i, s in enumerate(("Engine.swift", "Recorder.swift", "Replay.swift", "EngineTests.swift")):
        b.append(f'<circle cx="{x0 + 22}" cy="{301 + i * 22}" r="3.5" fill="{p["iris"]}"/>')
        b.append(text(x0 + 34, 305 + i * 22, s, p["text"], 12, mono=True))
    b.append(text(x0 + 16, 408, "not reached: Shape.swift, Package.swift", p["muted"], 11))

    b.append(text(480, 452, "Tests are told apart from test helpers; a test reached through a helper still counts. "
                  "Every list is bounded, and truncation is marked.", p["muted"], 11, anchor="middle"))
    return svg(W, H, "What one orient call returns",
               "orient on Engine.updateLocation in the Swift fixture returns its callers at depth 1 (Recorder.record, "
               "replay, the makeEngine test helper) and depth 2 (two tests), no project callees, the two tests that "
               "reach it with a command to run only them, and the four live files out of six.",
               "".join(b))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, palette in PALETTES.items():
        (OUT / f"architecture-{name}.svg").write_text(architecture(palette))
        (OUT / f"orient-{name}.svg").write_text(orient(palette))
    print(f"wrote {len(PALETTES) * 2} diagrams to {OUT}")


if __name__ == "__main__":
    main()
