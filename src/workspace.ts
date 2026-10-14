// Route each request to its source-language session, including mixed repositories.
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import * as z from "zod/v4";
import { parseSymbolQuery, ResolveError } from "./graph/symbols.js";
import { profiles, profileById, type Profile } from "./profiles/index.js";
import { executable, exists } from "./profiles/common.js";
import { Session } from "./session.js";

export const ProfileId = z.enum(["swift", "rust", "c", "typescript", "wasm", "python"]);
const ServerConfig = z.object({
  root: z.string().optional(), command: z.string().optional(), args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(), initializationOptions: z.record(z.string(), z.unknown()).optional(),
}).strict();
const Config = z.object({ default_profile: ProfileId.optional(), profiles: z.partialRecord(ProfileId, ServerConfig).optional() }).strict();
type Settings = z.infer<typeof Config>;

function merge(a: unknown, b: unknown): unknown {
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) || Array.isArray(b)) return b;
  const out = { ...a } as Record<string, unknown>;
  for (const [key, value] of Object.entries(b)) out[key] = key in out ? merge(out[key], value) : value;
  return out;
}

export class Workspace {
  private readonly sessions = new Map<string, Session>();
  private constructor(readonly rootPath: string, private readonly settings: Settings, readonly forcedProfile?: string) {}

  static async load(root: string, forcedProfile?: string): Promise<Workspace> {
    let settings: Settings = {};
    try { settings = Config.parse(JSON.parse(await readFile(join(root, ".rarefaction.json"), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (forcedProfile && !profileById(forcedProfile)) throw new Error(`Unknown profile ${forcedProfile}; use ${profiles.map(p => p.id).join(", ")}`);
    return new Workspace(realpathSync.native(root), settings, forcedProfile);
  }

  private within(path: string): string {
    let full = resolve(this.rootPath, path);
    try { full = realpathSync.native(full); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const rel = relative(this.rootPath, full);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new ResolveError("project and source paths must stay inside the workspace root.");
    return full;
  }

  session(id: string, project?: string): Session {
    const base = profileById(id);
    if (!base) throw new ResolveError(`Unknown profile ${id}.`);
    const config = this.settings.profiles?.[id as z.infer<typeof ProfileId>];
    const root = this.within(project ?? config?.root ?? ".");
    const key = `${id}:${root}`;
    let session = this.sessions.get(key);
    if (!session) {
      const profile: Profile = { ...base,
        ...(base.needsSourceScan ? { needsSourceScan: async (path: string) => !config?.args?.some(a => a.startsWith("--compile-commands-dir")) && await base.needsSourceScan!(path) } : {}),
        async launch(path) {
          const launch = await base.launch(path);
          const command = config?.command ?? launch.command;
          const found = await executable(command, config?.env?.PATH ?? process.env.PATH);
          if (!found) throw new ResolveError(`Language server executable "${command}" not found. Install it or set profiles.${id}.command in .rarefaction.json.`);
          return { ...launch, command: found, args: config?.args ?? launch.args,
            env: { ...launch.env, ...config?.env },
            initializationOptions: config?.initializationOptions ? merge(launch.initializationOptions, config.initializationOptions) : launch.initializationOptions };
        },
      };
      session = new Session(root, profile);
      this.sessions.set(key, session);
    }
    return session;
  }

  async inventory(project?: string): Promise<Session[]> {
    // Show missing prerequisites too, rather than hiding a configured profile.
    const candidates = profiles.map(p => this.session(p.id, project));
    const detection = await Promise.all(candidates.map(s => s.detection()));
    return candidates.filter((s, i) => detection[i]!.ok || this.settings.profiles?.[s.profile.id as z.infer<typeof ProfileId>] || s.profile.id === this.forcedProfile);
  }

  async select(input: { profile?: string | undefined; project?: string | undefined; symbol?: string | undefined }): Promise<Session> {
    const query = input.symbol ? parseSymbolQuery(input.symbol) : undefined;
    const extensionProfile = query?.kind === "position" ? profiles.find(p => p.extensions.includes(extname(query.file)))?.id : undefined;
    const id = input.profile ?? this.forcedProfile ?? extensionProfile ?? this.settings.default_profile;
    let project = input.project;
    // Nested source projects should not inherit the monorepo's unrelated root.
    const markers = id ? profileById(id)?.rootMarkers ?? [] : [];
    if (query?.kind === "position" && !project && markers.length) {
      let dir = dirname(this.within(query.file));
      while (dir !== this.rootPath && !relative(this.rootPath, dir).startsWith("..")) {
        if ((await Promise.all(markers.map(marker => exists(join(dir, marker))))).some(Boolean)) {
          project = relative(this.rootPath, dir); break;
        }
        dir = dirname(dir);
      }
    }
    if (id) return this.session(id, project);
    const candidates = await this.inventory(project);
    if (candidates.length === 1) return candidates[0]!;
    throw new ResolveError(candidates.length ? `Mixed-language workspace: pass profile (${candidates.map(s => s.profile.id).join(", ")}) or use a path:line:column symbol. Use project for a nested package.` : "No supported sources found. Use status, or specify profile and project.");
  }

  /** Convert a workspace-relative position to the selected session's root. */
  symbolFor(session: Session, symbol: string): string {
    const q = parseSymbolQuery(symbol);
    if (q.kind !== "position") return symbol;
    const full = this.within(q.file);
    if (session.profile.isExternal(pathToFileURL(full).href, session.rootPath)) throw new ResolveError("Symbol is outside the selected project or is a build/dependency file.");
    return `${full}:${q.line}:${q.character}`;
  }

  async close(): Promise<void> { await Promise.all([...this.sessions.values()].map(s => s.close())); }
}
