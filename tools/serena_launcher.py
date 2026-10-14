#!/usr/bin/env python3
"""Launch installed Serena with the local WAT adapter (no upstream patch)."""
import os
import shutil
from solidlsp.ls import SolidLanguageServer, LanguageServerDependencyProviderSinglePath
from solidlsp.ls_config import ExternalLanguageServerId, FilenameMatcher, LanguageServerRegistry


class WatLanguageServer(SolidLanguageServer):
    """Bridge .wat symbols/references/edits to the existing wat_server executable."""

    def __init__(self, config, repository_root_path, solidlsp_settings):
        super().__init__(config, repository_root_path, None, "wat", solidlsp_settings)

    class DependencyProvider(LanguageServerDependencyProviderSinglePath):
        def _get_or_install_core_dependency(self):
            path = shutil.which("wat_server")
            if not path:
                raise FileNotFoundError("Install wat_server and include it in the Serena MCP PATH")
            return path

        def _create_launch_command(self, core_path):
            return [core_path]

    def _create_dependency_provider(self):
        return self.DependencyProvider(self._custom_settings, self._ls_resources_dir)

    def _create_base_initialize_params(self):
        return {"capabilities": {
            "textDocument": {
                "documentSymbol": {"hierarchicalDocumentSymbolSupport": True},
                "definition": {"linkSupport": True},
            },
            "workspace": {"workspaceFolders": True, "configuration": True},
        }}

    def _start_server(self):
        self.server.on_request("workspace/configuration", lambda p: [{} for _ in p.get("items", [])])
        self.server.on_request("client/registerCapability", lambda p: None)
        self.server.start()
        self.server.send.initialize(self._create_initialize_params())
        self.server.notify.initialized({})


def register_wat():
    LanguageServerRegistry.get_instance().register(
        ExternalLanguageServerId(key="wat", matcher=FilenameMatcher(".wat"), implementation=WatLanguageServer, priority=2)
    )


if __name__ == "__main__":
    register_wat()
    # Claude documents this stable root; otherwise leave Codex's cwd unchanged.
    if os.environ.get("CLAUDE_PROJECT_DIR"):
        os.chdir(os.environ["CLAUDE_PROJECT_DIR"])
    from serena.cli import top_level
    top_level()
