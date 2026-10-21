// Route each request to its source-language session, including mixed repositories.
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, dirname, sep } from "node:path";
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

type SelectInput = { profile?: string | undefined; project?: string | undefined; symbol?: string | undefined };
export interface Selection { session: Session; warnings: string[] }

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

  async select(input: SelectInput): Promise<Session> { return (await this.route(input)).session; }

  /** The session for a request, with warnings about how it was chosen. */
  async route(input: SelectInput): Promise<Selection> {
    const query = input.symbol ? parseSymbolQuery(input.symbol) : undefined;
    const extensionProfile = query?.kind === "position" ? profiles.find(p => p.extensions.includes(extname(query.file)))?.id : undefined;
    const id = input.profile ?? this.forcedProfile ?? extensionProfile ?? this.settings.default_profile;
    let project = input.project;
    const warnings: string[] = [];
    // Nested source projects should not inherit the monorepo's unrelated root,
    // and workspace members should not lose their sibling members.
    const profile = id ? profileById(id) : undefined;
    if (query?.kind === "position" && !project && profile?.rootMarkers?.length) {
      const routed = await this.projectFor(this.within(query.file), profile);
      if (routed) { project = routed.project; warnings.push(...routed.warnings); }
    }
    if (id) return { session: this.session(id, project), warnings };
    const candidates = await this.inventory(project);
    if (candidates.length === 1) return { session: candidates[0]!, warnings };
    throw new ResolveError(candidates.length ? `Mixed-language workspace: pass profile (${candidates.map(s => s.profile.id).join(", ")}) or use a path:line:column symbol. Use project for a nested package.` : "No supported sources found. Use status, or specify profile and project.");
  }

  /**
   * The project for a position without `project`: the outermost workspace that
   * declares the file's nearest marked directory a member, else that directory.
   * Undefined when the nearest marker is the workspace root's own, or there is
   * none (the configured or default root then applies).
   */
  private async projectFor(file: string, profile: Profile): Promise<{ project: string; warnings: string[] } | undefined> {
    const markerIn = async (dir: string) => {
      for (const marker of profile.rootMarkers ?? []) if (await exists(join(dir, marker))) return marker;
      return undefined;
    };
    const ancestors: string[] = [];
    for (let dir = dirname(file); ; dir = dirname(dir)) {
      const rel = relative(this.rootPath, dir);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) break;
      ancestors.push(dir);
      if (dir === this.rootPath || dir === dirname(dir)) break;
    }
    let nearest = -1, marker: string | undefined;
    for (let i = 0; i < ancestors.length && !marker; i++) { marker = await markerIn(ancestors[i]!); if (marker) nearest = i; }
    const member = ancestors[nearest];
    if (!member || member === this.rootPath) return undefined;
    let chosen = member;
    let enclosing: { dir: string; kind: "group" | "nested"; marker?: string } | undefined;
    for (const dir of ancestors.slice(nearest + 1)) {
      const verdict = await profile.enclosingWorkspace?.(dir, member);
      if (verdict === "workspace") { chosen = dir; enclosing = undefined; continue; }
      const outerMarker = await markerIn(dir);
      if (verdict === "group") enclosing = { dir, kind: "group" };
      else if (outerMarker) enclosing = { dir, kind: "nested", marker: outerMarker };
    }
    const name = (dir: string) => relative(this.rootPath, dir).split(sep).join("/") || ".";
    const place = (dir: string) => dir === this.rootPath ? "The workspace root" : `"${name(dir)}"`;
    const answered = chosen === member ? `Answered from "${name(chosen)}" only, the nearest directory with a ${marker}.` : `Answered from the workspace at "${name(chosen)}" only.`;
    const warnings = !enclosing ? [] : [enclosing.kind === "group"
      ? `${answered} ${place(enclosing.dir)} groups it with other packages, but the language server answers one package at a time, so callers in other packages are not listed, even with project set.`
      : `${answered} ${place(enclosing.dir)} has its own ${enclosing.marker} but does not list it as a workspace member, so files outside it are not searched; pass project "${name(enclosing.dir)}" if it belongs to that project.`];
    return { project: name(chosen), warnings };
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
