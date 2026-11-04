import { E as createWriteCoordinator, S as WEB_MAX_CHARS_PER_PAGE, T as createStoreWriteScopeJournal, d as DEFAULT_SETTINGS, k as NexusError, m as FILE_READ_MAX_LINES, n as createWebResultRepository, p as FILE_OUTPUT_MAX_BYTES, t as Config, u as DEFAULT_LIBRARY, w as combineManagedCleanup } from "./config-DgOqgGA7.js";
import { SessionId } from "@deepseek-ai/dsh-session";
import { ZodError, z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isLoopbackHost } from "@deepseek-ai/dsh-host-webserver";
// src/preset/definition.ts
/** Stable preset id a session records and the console selects. */
const NEXUS_PRESET_ID = "nexus";
/** Display name of the preset in the native selection roster. */
const NEXUS_PRESET_NAME = "Nexus";
/** Loader entry id of this package's preset sub-entry. */
const NEXUS_PRESET_ROW_ID = "dsh-nexus-runtime";
/** Module specifier of the preset contribution sub-entry. */
const NEXUS_PRESET_ENTRY = "dsh-nexus/preset";
/** Byte budget for the project instruction file, matching the native preset. */
const NEXUS_INSTRUCTIONS_MAX_BYTES = 65536;
/** The native tool-result pruning budgets of the isolated Nexus mechanism. */
const NEXUS_PRUNER_LIMITS = Object.freeze({
	thresholdChars: 8192,
	headChars: 4096,
	tailChars: 1024
});
/**
* The rows every Nexus generation mounts.
*
* Kept as a function so each call produces a fresh, mutable array: the registry
* stores the definition and the console serializes it, and sharing one frozen
* array between callers would make a later edit of one visible in another.
* @param deployment - validated row configuration of the `dsh-nexus` host row.
* @returns the rows in declaration order.
*/
function baseRows(deployment) {
	return [
		{
			id: NEXUS_PRESET_ROW_ID,
			name: NEXUS_PRESET_ENTRY,
			config: {
				...deployment.bashPath === void 0 ? {} : { bashPath: deployment.bashPath },
				...deployment.pwshPath === void 0 ? {} : { pwshPath: deployment.pwshPath }
			}
		},
		{
			id: "agent-instructions",
			name: "@deepseek-ai/dsh-agent-instructions",
			config: { maxBytes: NEXUS_INSTRUCTIONS_MAX_BYTES }
		},
		{
			id: "skill-filesystem",
			name: "@deepseek-ai/dsh-skill-filesystem"
		},
		{
			id: "tool-skill",
			name: "@deepseek-ai/dsh-tool-skill"
		},
		{
			id: "tool-ask-user",
			name: "@deepseek-ai/dsh-tool-ask-user"
		},
		{
			id: "tool-todo",
			name: "@deepseek-ai/dsh-tool-todo",
			config: { allowParallelInProgress: true }
		}
	];
}
/**
* The isolated compaction group a Nexus generation mounts when it inherits none.
* @returns one group row holding the backend, the human command and the pruner.
*/
function compactionRow() {
	return {
		id: "compaction",
		name: "cordis:group",
		group: true,
		isolate: {
			compaction: true,
			toolResultPruner: true
		},
		config: [
			{
				id: "compaction-basic",
				name: "@deepseek-ai/dsh-compaction-basic"
			},
			{
				id: "command-compact",
				name: "@deepseek-ai/dsh-command-compact"
			},
			{
				id: "tool-result-pruner",
				name: "@deepseek-ai/dsh-compaction-tool-result-pruner",
				config: { ...NEXUS_PRUNER_LIMITS }
			}
		]
	};
}
/**
* Build the Nexus preset definition.
*
* @param config - validated deployment configuration of the `dsh-nexus` row.
* @param native - what the host realm already supplies.
* @returns the definition the host row registers under {@link NEXUS_PRESET_ID}.
* @throws NexusError `UNSUPPORTED_CAPABILITY` when the inherited compaction
*   capability is ambiguous; mounting a second mechanism or assuming the
*   partial one is complete would both be guesses.
*/
function createNexusPreset(config, native) {
	if (native.compaction === "ambiguous") throw new NexusError("UNSUPPORTED_CAPABILITY", `cannot compose the Nexus preset: the inherited compaction capability is ambiguous. ${native.evidence.join("; ")}`);
	const rows = baseRows(config);
	if (native.compaction === "absent") rows.push(compactionRow());
	return {
		id: NEXUS_PRESET_ID,
		name: NEXUS_PRESET_NAME,
		description: native.compaction === "host" ? "Nexus: files, shell, web, internal agents, native skills/questions/todos and the host compaction mechanism." : "Nexus: files, shell, web, internal agents, native skills/questions/todos and an isolated compaction mechanism.",
		order: 2,
		plugins: rows
	};
}
// src/preset/native.ts
/** Modules that make up one compaction mechanism in a live preset generation. */
const COMPACTION_MODULES = Object.freeze([
	"@deepseek-ai/dsh-compaction-basic",
	"@deepseek-ai/dsh-command-compact",
	"@deepseek-ai/dsh-compaction-tool-result-pruner"
]);
/**
* Whether one resolved value satisfies the compaction engine contract.
* @param engine - service resolved as `compaction`.
* @returns true only for an object exposing the three documented operations.
*/
function isCompactionEngine(engine) {
	if (engine === null || typeof engine !== "object") return false;
	const contract = engine;
	return typeof contract.compactIfNeeded === "function" && typeof contract.compactNow === "function" && typeof contract.compactRegion === "function";
}
/**
* Whether one resolved value satisfies the tool-result pruner contract.
* @param pruner - service resolved as `toolResultPruner`.
* @returns true only for an object that can measure, prune and rewrite a session.
*/
function isToolResultPruner(pruner) {
	if (pruner === null || typeof pruner !== "object") return false;
	const contract = pruner;
	return typeof contract.pruneContent === "function" && typeof contract.pruneSession === "function";
}
/**
* Read which retained preset generations compose a compaction mechanism inside
* their own scope.
*
* This is contribution evidence at the target scope, not a module-name guess:
* the registry reports the modules of each live generation, and a generation's
* isolated rows are exactly what a different preset's Agents see. They are
* reported because they are NOT available to a Nexus Agent.
* @param ctx - host context.
* @returns one line per generation that composes a compaction module.
*/
function scopedCompactionFacts(ctx) {
	const presets = ctx.get("agentPresets");
	if (presets === void 0) return [];
	const facts = [];
	for (const composition of presets.inspectCompositions()) {
		const modules = composition.modules.map((module) => module.moduleName).filter((name) => COMPACTION_MODULES.includes(name));
		if (modules.length === 0) continue;
		facts.push(`preset "${composition.id}" composes ${modules.join(", ")} inside its own generation scope, which a Nexus generation does not inherit`);
	}
	return facts;
}
/**
* Detect the composition a Nexus preset may rely on.
*
* Call from the host context that opens the runtime, after the native services
* it reads are mounted. The read is synchronous and side-effect free: it
* resolves two services, checks their contract shape and asks the preset
* registry for its live generations.
* @param ctx - host context of the `dsh-nexus` row.
* @returns the decision plus the facts behind it.
*/
function detectNativeComposition(ctx) {
	const engine = ctx.get("compaction");
	const pruner = ctx.get("toolResultPruner");
	const engineOk = isCompactionEngine(engine);
	const prunerOk = isToolResultPruner(pruner);
	const scoped = scopedCompactionFacts(ctx);
	const evidence = [];
	if (engine !== void 0) evidence.push(engineOk ? "the host realm resolves a `compaction` engine that implements compactIfNeeded/compactNow/compactRegion" : "the host realm resolves a `compaction` service that does not implement the compaction engine contract");
	else evidence.push("the host realm resolves no `compaction` service");
	if (pruner !== void 0) evidence.push(prunerOk ? "the host realm resolves a `toolResultPruner` that can measure, prune and rewrite tool results" : "the host realm resolves a `toolResultPruner` that does not implement the pruner contract");
	else evidence.push("the host realm resolves no `toolResultPruner` service");
	evidence.push(...scoped);
	if (engineOk && prunerOk) {
		evidence.push("a Nexus generation inherits this one mechanism, so the preset mounts none of its own");
		return Object.freeze({
			compaction: "host",
			evidence: Object.freeze(evidence)
		});
	}
	if (engine === void 0 && pruner === void 0) {
		evidence.push("no compaction mechanism is inherited, so the preset mounts one isolated group");
		return Object.freeze({
			compaction: "absent",
			evidence: Object.freeze(evidence)
		});
	}
	evidence.push("the inherited compaction capability is only partly present, so the preset refuses to guess");
	return Object.freeze({
		compaction: "ambiguous",
		evidence: Object.freeze(evidence)
	});
}
// src/prompts/base.ts
/**
* The Nexus base system prompt.
*
* This is the spec's base text verbatim (spec §9.1): one persona sentence and
* one delivery sentence, separated by a single blank line. It deliberately
* carries no planning, review, tool-list or reply-style rules — tool guidance,
* skills and workspace instructions reach the model through their own
* mechanisms — and it is never stored in the library, so a user cannot edit it
* and it is identical for every Nexus session.
*
* @module dsh-nexus/prompts/base
*/
/** The base system prompt of every Nexus session. */
const BASE_PROMPT = `你是一名运行在 DeepSeek Harness（DSH）Agent 框架内的专业编程助手。

你通过读取文件、执行命令、编辑代码和创建文件，高效地帮助用户完成任务，并交付高质量的成果。`;
// src/prompts/assemble.ts
/** Text placed between the base prompt and each selected body. */
const PART_SEPARATOR = "\n\n";
/**
* Index one library's modules by id, refusing an ambiguous record.
* @param library - the library to index.
* @returns the module for each id.
* @throws NexusError `INVALID_ARGUMENT` when one id is held twice.
*/
function indexLibrary(library) {
	const byId = /* @__PURE__ */ new Map();
	for (const module of library.modules) {
		if (byId.has(module.id)) throw new NexusError("INVALID_ARGUMENT", `the prompt library holds more than one module with id "${module.id}"; refusing to guess which body the selection means`);
		byId.set(module.id, module);
	}
	return byId;
}
/**
* Resolve a selection against a library, in selection order.
* @param library - the library to resolve against.
* @param selection - module ids in assembly order.
* @returns the selected modules, in selection order.
* @throws NexusError `INVALID_ARGUMENT` for a repeated, unknown or ambiguous id.
*/
function selectedPromptModules(library, selection) {
	const byId = indexLibrary(library);
	const chosen = [];
	const seen = /* @__PURE__ */ new Set();
	for (const id of selection) {
		if (seen.has(id)) throw new NexusError("INVALID_ARGUMENT", `the selection names module "${id}" more than once`);
		seen.add(id);
		const module = byId.get(id);
		if (module === void 0) throw new NexusError("INVALID_ARGUMENT", `the selection names module "${id}", which the prompt library does not hold`);
		chosen.push(module);
	}
	return chosen;
}
/**
* Compose the prompt text of already captured modules.
*
* A snapshot renders from its own captured bodies, so a later library edit or
* deletion cannot change text that was already assembled.
* @param modules - selected modules in assembly order.
* @returns the base prompt followed by each body.
*/
function composePromptText(modules) {
	if (modules.length === 0) return BASE_PROMPT;
	return [BASE_PROMPT, ...modules.map((module) => module.body)].join(PART_SEPARATOR);
}
// src/protocol.ts
/** HTTP console namespace; these named routes have their own security boundary. */
const NEXUS_API_PREFIX = "/api/dsh-nexus";
/** Every accepted display mode, in display order; the stored field accepts only these. */
const TOOL_DISPLAY_MODES = [
	"nexus",
	"auto",
	"native"
];
/** Every accepted child-access ceiling, in display order. */
const CHILD_ACCESS_SETTINGS = [
	"inherit",
	"workspace-write",
	"read-only"
];
// src/storage/domain.ts
/**
* The durable record shapes and the domain declaration they belong to.
*
* Record schemas are zod, matching the domain data form: the domain validates
* every stored record against them when it loads the medium, so a hand-edited or
* corrupt record fails the open instead of reaching a tool. `src/protocol.ts`
* owns the TypeScript view of the same shapes; these schemas are its runtime
* twin.
*
* @module dsh-nexus/storage/domain
*/
/** Domain name on the storage hub; also the medium's unit name. */
const NEXUS_DOMAIN_NAME = "dsh_nexus";
/** Table holding the single prompt-library record. */
const LIBRARY_TABLE = "library";
/** Table holding the single settings record. */
const SETTINGS_TABLE = "settings";
/** Table holding one prompt snapshot per session. */
const PROMPTS_TABLE = "prompts";
/** Table holding saved web documents, keyed by owner and result id. */
const WEB_TABLE = "web_documents";
/** Table holding the durable policy of each internal child. */
const CHILD_POLICY_TABLE = "child_policies";
/** Table holding one write-scope reservation per child whose cleanup is unresolved. */
const WRITE_SCOPE_TABLE = "write_scopes";
/**
* Key of a table that holds exactly one record. Keys stay opaque because the
* domain uses the `single` layout, which keeps the whole unit in one document.
*/
const SINGLETON_KEY = "current";
/** One prompt module as stored. */
const promptModuleSchema = z.object({
	id: z.string(),
	name: z.string(),
	body: z.string()
});
/** The prompt library as stored; array order is assembly order. */
const promptLibrarySchema = z.object({
	modules: z.array(promptModuleSchema),
	defaultSelection: z.array(z.string())
});
/** One session's assembled prompt as stored: the bodies themselves, not references. */
const promptSnapshotSchema = z.object({
	sessionId: z.string(),
	selection: z.array(z.string()),
	modules: z.array(promptModuleSchema),
	text: z.string()
});
/**
* The settings record as stored.
*
* Every editable number carries the bound from `runtime/defaults.ts`, so a
* settings record the store accepts is one the tools can act on: a value outside
* its range is refused at the write boundary and also fails loudly if a
* hand-edited medium carries it at open.
*/
const runtimeSettingsSchema = z.object({
	files: z.object({
		defaultLines: z.number().int().min(1).max(FILE_READ_MAX_LINES),
		maxOutputBytes: z.number().int().min(1).max(FILE_OUTPUT_MAX_BYTES)
	}),
	terminal: z.object({
		engine: z.enum(["bash", "pwsh"]),
		bashPath: z.string().min(1).optional(),
		pwshPath: z.string().min(1).optional()
	}),
	agents: z.object({
		concurrency: z.number().int().min(1).max(16),
		maxDepth: z.number().int().min(0).max(8),
		childAccess: z.enum(CHILD_ACCESS_SETTINGS).catch("read-only").default("inherit"),
		role: z.object({
			name: z.string().optional(),
			instructions: z.string().optional(),
			model: z.string().optional(),
			provider: z.string().trim().transform((value) => value === "" ? void 0 : value).optional()
		}).optional()
	}),
	web: z.object({
		maxResults: z.number().int().positive().max(10),
		maxCharsPerPage: z.number().int().positive().max(WEB_MAX_CHARS_PER_PAGE)
	}),
	toolDisplay: z.enum(TOOL_DISPLAY_MODES).catch("nexus")
});
/** A saved web result as stored. */
const webDocumentSchema = z.object({
	owner: z.string(),
	resultId: z.string(),
	kind: z.enum(["search", "fetch"]),
	source: z.string(),
	url: z.string().optional(),
	query: z.string().optional(),
	content: z.string(),
	summary: z.string().optional(),
	convertedText: z.string().optional(),
	textBasis: z.enum([
		"content",
		"converted-text",
		"summary",
		"search-results"
	]),
	conversionSkipped: z.boolean().optional(),
	upstreamTruncated: z.boolean(),
	savedTruncated: z.boolean(),
	createdAt: z.string(),
	expiresAt: z.string()
});
/** One write-scope reservation as stored. */
const writeScopeSchema = z.object({
	childId: z.string(),
	root: z.string()
});
/** One internal child's durable policy as stored. */
const childPolicySchema = z.object({
	childId: z.string(),
	parentSessionId: z.string(),
	cwd: z.string(),
	access: z.enum(["read", "write"]),
	maxDepth: z.number()
});
/**
* Key of one saved web document.
*
* `owner` and `resultId` are arbitrary strings (a session id is not an
* identifier-safe token), so the key is a JSON pair rather than a joined string:
* no separator can collide with either part. Opaque keys are why this domain uses
* the `single` layout.
* @param owner - session that owns the result.
* @param resultId - result id within that owner.
* @returns the record key.
*/
function webRecordKey(owner, resultId) {
	return JSON.stringify([owner, resultId]);
}
/**
* The Nexus domain: two singleton records plus three per-owner tables.
*
* The layout is stated rather than inherited so the key shapes above stay legal:
* `single` keeps every table record in one unit document and leaves keys opaque.
*/
const NEXUS_DOMAIN = defineDomain({
	name: NEXUS_DOMAIN_NAME,
	version: 1,
	layout: "single",
	tables: {
		[LIBRARY_TABLE]: domainTable(promptLibrarySchema),
		[SETTINGS_TABLE]: domainTable(runtimeSettingsSchema),
		[PROMPTS_TABLE]: domainTable(promptSnapshotSchema),
		[WEB_TABLE]: domainTable(webDocumentSchema),
		[CHILD_POLICY_TABLE]: domainTable(childPolicySchema),
		[WRITE_SCOPE_TABLE]: domainTable(writeScopeSchema)
	}
});
// src/prompts/validate.ts
/** One write/application validator; stored reads remain recovery-friendly. */
const libraryInput = z.strictObject({
	modules: z.array(promptModuleSchema.strict()).max(32),
	defaultSelection: z.array(z.string())
});
/** Validate and detach a complete library before save, explicit apply or preview. */
function validatePromptLibrary(value) {
	const result = libraryInput.safeParse(value);
	if (!result.success) throw new NexusError("INVALID_ARGUMENT", "The prompt library has an invalid shape or module count.");
	const library = result.data;
	let bytes = 0;
	for (const module of library.modules) {
		const size = Buffer.byteLength(module.body, "utf8");
		if (module.id.trim().length === 0 || size > 32768) throw new NexusError("INVALID_ARGUMENT", "Module ids must be nonempty and each body must fit 32 KiB of UTF-8.");
		bytes += size;
	}
	if (bytes > 131072) throw new NexusError("INVALID_ARGUMENT", "All module bodies together must fit 128 KiB of UTF-8.");
	selectedPromptModules(library, library.defaultSelection);
	return library;
}
// src/prompts/sessions.ts
/**
* Detach, render and freeze one snapshot.
*
* The bodies, the selection and the record are copied out of whatever produced
* them (a library record or a stored snapshot the domain also hands to other
* readers) and frozen, so no caller and no later library edit can mutate text
* that a request already holds. The text is passed in rather than recomposed so
* a restored snapshot keeps the exact text it was persisted with.
* @param sessionId - durable session owning the snapshot.
* @param selection - module ids in assembly order.
* @param modules - the actual bodies, in selection order.
* @param text - the prompt text those bodies compose.
* @returns the frozen snapshot.
*/
function freezeSnapshot(sessionId, selection, modules, text) {
	const bodies = modules.map((module) => Object.freeze({
		id: module.id,
		name: module.name,
		body: module.body
	}));
	return Object.freeze({
		sessionId,
		selection: Object.freeze([...selection]),
		modules: Object.freeze(bodies),
		text
	});
}
/** One instance of the prompt-session state. */
var PromptSessionsHandle = class {
	ctx;
	store;
	/** Effective state per exact Agent; a session id alone never addresses an entry. */
	entries = /* @__PURE__ */ new WeakMap();
	/** Tail of the serialized durable work for one session id, across residencies. */
	queues = /* @__PURE__ */ new Map();
	/** Whether new durable operations are refused; set before a teardown drains. */
	admissionsClosed = false;
	/** Listener disposer for the instance's own Agent lifecycle fact. */
	detachLifecycle;
	/**
	* @param ctx - scope that owns the lifecycle listener and resolves the live parent Agent.
	* @param store - durable Nexus store holding the per-session snapshots.
	*/
	constructor(ctx, store) {
		this.ctx = ctx;
		this.store = store;
		this.detachLifecycle = ctx.on("agent/disposed", ({ agent }) => {
			this.entries.delete(agent);
		});
	}
	async initialize(agent) {
		this.assertAdmitting("initialize the Nexus prompt");
		const entry = this.entryFor(agent);
		return this.serialize(entry.sessionId, () => this.resolveInitial(entry));
	}
	async apply(agent, selection, expectedLibraryHash, assertTarget) {
		this.assertAdmitting("apply a Nexus prompt");
		const entry = this.entries.get(agent);
		if (entry === void 0) throw new NexusError("NO_AGENT", `the Nexus prompt for session "${agent.id}" was never initialized; apply needs the exact Agent whose persona registration ran, not a session id`);
		return this.serialize(entry.sessionId, () => this.applySelection(entry, selection, expectedLibraryHash, assertTarget));
	}
	peek(agent) {
		const entry = this.entries.get(agent);
		if (entry?.snapshot === void 0) throw new NexusError("NO_AGENT", `this Agent has no effective Nexus prompt snapshot; only an Agent whose persona registration initialized it can be read, and a session id, a disposed Agent or a foreign Agent is not one`);
		return entry.snapshot;
	}
	async drain() {
		while (this.queues.size > 0) await Promise.all([...this.queues.values()]);
	}
	closeAdmissions() {
		this.admissionsClosed = true;
	}
	dispose() {
		this.admissionsClosed = true;
		this.detachLifecycle();
	}
	/**
	* Refuse a new durable operation once the owner stopped admitting work.
	* @param action - what the caller tried, for the message.
	* @throws NexusError `RESOURCE_NOT_AVAILABLE` while shutting down.
	*/
	assertAdmitting(action) {
		if (this.admissionsClosed) throw new NexusError("RESOURCE_NOT_AVAILABLE", `cannot ${action}: the Nexus runtime is shutting down and admits no new durable prompt work`);
	}
	/**
	* Read or create the entry for one Agent.
	* @param agent - the exact Agent.
	* @returns its entry, created empty on first use.
	*/
	entryFor(agent) {
		const existing = this.entries.get(agent);
		if (existing !== void 0) return existing;
		const entry = {
			agent,
			sessionId: agent.id,
			snapshot: void 0
		};
		this.entries.set(agent, entry);
		return entry;
	}
	/**
	* Run one complete logical operation after everything already queued for the
	* same durable session.
	*
	* The queue is keyed by session id, not by the live Agent: a restart mints a
	* second Agent for the same session, and the new residency's restore must
	* observe the old residency's durable write instead of racing it. `task` is the
	* WHOLE operation (restore, or capture/check/write/publish), so a write can
	* never land after newer work that was queued behind it. Only the current tail
	* is retained; once it settles it is dropped, so an idle session keeps no queue
	* entry. A rejection is carried forward as "settled" for the next operation
	* while the caller still receives its own error.
	* @param sessionId - durable session whose durable work is serialized.
	* @param task - complete operation to run.
	* @returns the operation's result.
	*/
	serialize(sessionId, task) {
		const next = (this.queues.get(sessionId) ?? Promise.resolve()).then(task, task);
		const settled = next.catch(() => void 0);
		this.queues.set(sessionId, settled);
		settled.then(() => {
			if (this.queues.get(sessionId) === settled) this.queues.delete(sessionId);
		});
		return next;
	}
	/**
	* Refuse work for an Agent that is no longer the live entry for its session.
	*
	* A queued operation can become stale before it starts, and an Agent can be
	* disposed while its snapshot is being captured; both must fail instead of
	* writing for a residency that no longer exists.
	* @param entry - the entry the queued operation was created for.
	* @throws NexusError `NO_AGENT` when that exact Agent is no longer live here.
	*/
	assertLive(entry) {
		if (this.entries.get(entry.agent) !== entry) throw new NexusError("NO_AGENT", `the Nexus prompt work for session "${entry.sessionId}" was refused: this Agent was disposed before the operation could run, and a session id alone cannot address another Agent's state`);
	}
	/**
	* Resolve one Agent's first snapshot: its own saved record, else an inherited
	* parent snapshot, else the library default selection.
	* @param entry - the Agent's entry.
	* @returns the effective snapshot.
	*/
	async resolveInitial(entry) {
		this.assertLive(entry);
		if (entry.snapshot !== void 0) return entry.snapshot;
		const saved = await this.store.getPrompt(entry.sessionId);
		if (saved !== void 0) {
			if (saved.sessionId !== entry.sessionId) throw new NexusError("UNSUPPORTED_CAPABILITY", `the saved prompt for session "${entry.sessionId}" names session "${saved.sessionId}"; refusing to restore a record that belongs to another session`);
			return this.publish(entry, freezeSnapshot(entry.sessionId, saved.selection, saved.modules, saved.text));
		}
		const inherited = await this.inheritedSnapshot(entry.agent);
		if (inherited !== void 0) {
			const snapshot = freezeSnapshot(entry.sessionId, inherited.selection, inherited.modules, inherited.text);
			this.assertLive(entry);
			await this.store.putPrompt(snapshot);
			return this.publish(entry, snapshot);
		}
		const library = await this.store.readLibrary();
		const modules = selectedPromptModules(library.value, library.value.defaultSelection);
		const snapshot = freezeSnapshot(entry.sessionId, library.value.defaultSelection, modules, composePromptText(modules));
		this.assertLive(entry);
		await this.store.putPrompt(snapshot);
		return this.publish(entry, snapshot);
	}
	/**
	* Read the parent snapshot a new delegated child starts from.
	*
	* The live parent Agent is asked first, so the child copies what the parent is
	* ACTUALLY running. Only when that Agent is gone does the parent's durable
	* record stand in — never the library, whose modules the parent may no longer
	* use.
	* @param agent - the child Agent being initialized.
	* @returns the parent's actual snapshot, or `undefined` when the parent lineage has none.
	*/
	async inheritedSnapshot(agent) {
		const header = agent.session.header;
		if (header.origin !== "subagent") return void 0;
		const parentSession = header.parentSession;
		if (parentSession === void 0) return void 0;
		const parentAgent = this.ctx.get("agents")?.get(parentSession);
		return (parentAgent === void 0 ? void 0 : this.entries.get(parentAgent)?.snapshot) ?? await this.store.getPrompt(parentSession);
	}
	/**
	* Apply one selection: check the hash, capture one library read, persist, publish.
	* @param entry - the Agent's entry.
	* @param selection - module ids in assembly order.
	* @param expectedLibraryHash - hash the caller last read.
	* @returns the newly published snapshot.
	*/
	async applySelection(entry, selection, expectedLibraryHash, assertTarget) {
		this.assertLive(entry);
		if (entry.snapshot === void 0) throw new NexusError("NO_AGENT", `the Nexus prompt for session "${entry.sessionId}" is not initialized yet; apply cannot replace a snapshot that does not exist`);
		const library = await this.store.readLibrary();
		if (library.hash !== expectedLibraryHash) throw new NexusError("CONFIG_CONFLICT", "the prompt library changed since it was read; read it again and reapply the selection you meant");
		const modules = selectedPromptModules(validatePromptLibrary(library.value), selection);
		const snapshot = freezeSnapshot(entry.sessionId, selection, modules, composePromptText(modules));
		this.assertLive(entry);
		assertTarget?.();
		await this.store.putPrompt(snapshot);
		assertTarget?.();
		return this.publish(entry, snapshot);
	}
	/**
	* Swap the effective reference after re-checking Agent identity.
	* @param entry - the entry the operation ran for.
	* @param snapshot - the prepared snapshot.
	* @returns the published snapshot.
	*/
	publish(entry, snapshot) {
		if (this.entries.get(entry.agent) !== entry) throw new NexusError("NO_AGENT", `the prepared Nexus prompt for session "${entry.sessionId}" was not published: this Agent was disposed while the snapshot was being prepared, and a session id alone cannot address another Agent's state`);
		entry.snapshot = snapshot;
		return snapshot;
	}
};
/**
* Create the prompt-session state.
*
* One instance owns the per-Agent effective references and the per-session
* durable queues for one plugin incarnation; production composition (the Nexus
* preset) creates it once and registers it per Agent scope (Task 9). Two live
* instances over one store are not serialized against each other.
* @param ctx - registration scope; it must reach `agents` to see a live parent.
* @param store - durable Nexus store.
* @returns the prompt-session state.
*/
function createPromptSessions(ctx, store) {
	return new PromptSessionsHandle(ctx, store);
}
// src/storage/store.ts
/**
* The Nexus store: the only writer of Nexus records.
*
* @module dsh-nexus/storage/store
*/
/**
* Serialize a record canonically so equal data always hashes equally: object
* keys are sorted and undefined-valued members are skipped, which is exactly what
* a JSON round trip keeps.
* @param value - JSON data.
* @returns its canonical JSON text.
*/
function canonicalJson(value) {
	if (value === null || typeof value !== "object") {
		const encoded = JSON.stringify(value);
		if (encoded === void 0) throw new TypeError("a stored record must be lossless JSON data");
		return encoded;
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.entries(value).filter(([, member]) => member !== void 0).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`).join(",")}}`;
}
/**
* Hash one record for lost-update detection.
* @param value - the record.
* @returns a hex SHA-256 of its canonical JSON.
*/
function hashRecord(value) {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
/**
* Validate one record against the schema the medium is read with, and keep the
* parsed copy: it holds declared fields only, so no caller-owned handle can ride
* along and a later caller mutation cannot reach the stored record.
* @param schema - schema of the table the record belongs to.
* @param value - the record a caller offered.
* @param what - record name for the failure message.
* @returns the detached, validated record.
* @throws NexusError `INVALID_ARGUMENT` when the record does not match.
*/
function parseRecord(schema, value, what) {
	try {
		return schema.parse(value);
	} catch (error) {
		const issue = error instanceof ZodError ? error.issues[0] : void 0;
		const location = issue === void 0 || issue.path.length === 0 ? "" : ` at '${issue.path.join(".")}'`;
		const reason = issue?.message ?? (error instanceof Error ? error.message : String(error));
		throw new NexusError("INVALID_ARGUMENT", `${what} is not a valid record${location}: ${reason}`, { cause: error });
	}
}
/** One open store over an opened domain; constructed by {@link openNexusStore}. */
var NexusStoreHandle = class {
	domain;
	library;
	settings;
	prompts;
	web;
	childPolicies;
	writeScopes;
	/**
	* @param domain - the opened Nexus domain this store owns.
	*/
	constructor(domain) {
		this.domain = domain;
		this.library = domain.table(LIBRARY_TABLE);
		this.settings = domain.table(SETTINGS_TABLE);
		this.prompts = domain.table(PROMPTS_TABLE);
		this.web = domain.table(WEB_TABLE);
		this.childPolicies = domain.table(CHILD_POLICY_TABLE);
		this.writeScopes = domain.table(WRITE_SCOPE_TABLE);
	}
	/** Materialize the two singleton records so a save always has a record to replace. */
	async seed() {
		if (this.library.get("current") === void 0) await this.library.put(SINGLETON_KEY, DEFAULT_LIBRARY);
		if (this.settings.get("current") === void 0) await this.settings.put(SINGLETON_KEY, DEFAULT_SETTINGS);
	}
	async readLibrary() {
		const value = this.library.get(SINGLETON_KEY);
		if (value === void 0) throw new Error("the prompt library record is missing from the Nexus domain");
		return {
			value,
			hash: hashRecord(value)
		};
	}
	async saveLibrary(value, expectedHash) {
		const next = parseRecord(promptLibrarySchema, value, "the prompt library");
		const stored = await this.library.update(SINGLETON_KEY, (current) => {
			if (hashRecord(current) !== expectedHash) throw new NexusError("CONFIG_CONFLICT", "the prompt library changed since it was read; read it again before saving");
			return next;
		});
		return {
			value: stored,
			hash: hashRecord(stored)
		};
	}
	async readSettings() {
		const value = this.settings.get(SINGLETON_KEY);
		if (value === void 0) throw new Error("the settings record is missing from the Nexus domain");
		return {
			value,
			hash: hashRecord(value)
		};
	}
	async saveSettings(value, expectedHash) {
		const next = parseRecord(runtimeSettingsSchema, value, "the runtime settings");
		const stored = await this.settings.update(SINGLETON_KEY, (current) => {
			if (hashRecord(current) !== expectedHash) throw new NexusError("CONFIG_CONFLICT", "the runtime settings changed since they were read; read them again before saving");
			return next;
		});
		return {
			value: stored,
			hash: hashRecord(stored)
		};
	}
	async getPrompt(sessionId) {
		return this.prompts.get(sessionId);
	}
	async putPrompt(value) {
		const record = parseRecord(promptSnapshotSchema, value, "the prompt snapshot");
		await this.prompts.put(record.sessionId, record);
	}
	async getWeb(owner, resultId) {
		return this.web.get(webRecordKey(owner, resultId));
	}
	async listWeb(owner) {
		const documents = [];
		for (const [, document] of this.web.entries()) if (document.owner === owner) documents.push(document);
		return documents.sort((left, right) => {
			if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
			return left.resultId < right.resultId ? -1 : left.resultId > right.resultId ? 1 : 0;
		});
	}
	async putWeb(value) {
		const record = parseRecord(webDocumentSchema, value, "the web document");
		await this.web.put(webRecordKey(record.owner, record.resultId), record);
	}
	async deleteWeb(owner, resultId) {
		return this.web.delete(webRecordKey(owner, resultId));
	}
	async getChildPolicy(childId) {
		return this.childPolicies.get(childId);
	}
	async putChildPolicy(value) {
		const record = parseRecord(childPolicySchema, value, "the child policy");
		await this.childPolicies.put(record.childId, record);
	}
	async deleteChildPolicy(childId) {
		await this.childPolicies.delete(childId);
	}
	async listWriteScopes() {
		return [...this.writeScopes.entries()].map(([, record]) => record);
	}
	async putWriteScope(value) {
		const record = parseRecord(writeScopeSchema, value, "the write-scope reservation");
		await this.writeScopes.put(record.childId, record);
	}
	async deleteWriteScope(childId) {
		await this.writeScopes.delete(childId);
	}
	async dispose() {
		await this.domain.close();
	}
};
/**
* Open the Nexus store on a context that carries the storage domain form.
*
* The caller owns the returned store's lifetime; the domain is also closed when
* the calling plugin unloads, so a crashed path cannot leave the unit open. The
* two singleton records are materialized here, before the store is handed out, so
* every later save is a conditional replace instead of a first-write race.
* @param ctx - context with `storageDomain` active.
* @param options - unload behaviour; see {@link OpenNexusStoreOptions}.
* @returns the opened store.
*/
async function openNexusStore(ctx, options = {}) {
	const domain = await ctx.storageDomain.open(NEXUS_DOMAIN);
	const store = new NexusStoreHandle(domain);
	try {
		await store.seed();
	} catch (error) {
		await domain.close();
		throw error;
	}
	if (options.disposeOnUnload !== false) ctx.effect(() => () => store.dispose(), "nexusStore");
	return store;
}
// src/runtime/service.ts
/** Stable Cordis service name hosting the one Nexus runtime of a deployment. */
const NEXUS_RUNTIME_SERVICE = "nexusRuntime";
/**
* Services the host row must declare before it opens the runtime.
*
* These are the cold-path dependencies of the opener itself; a row that omits
* them would activate, throw and leave the composition without a runtime. The
* opener still checks them at open time, so the failure is explicit either way.
*/
const NEXUS_RUNTIME_INJECT = Object.freeze(["storageDomain"]);
/**
* Open (or join) the one Nexus runtime of this deployment.
*
* Must be called from an active plugin context (a Loader row whose `inject`
* declares the storage services). Repeated calls — including from a later preset
* generation — return the same instance instead of opening a second store; a
* live runtime is never replaced by a fresh one.
* @param ctx - host plugin context providing `storageDomain`.
* @param config - deployment configuration for the row.
* @returns the runtime.
* @throws NexusError `UNSUPPORTED_CAPABILITY` when the native storage service is
*   not mounted; there is no in-memory fallback.
*/
async function openNexusRuntime(ctx, config) {
	const existing = ctx.get(NEXUS_RUNTIME_SERVICE);
	if (existing !== void 0) return existing;
	if (ctx.get("storageDomain") === void 0) throw new NexusError("UNSUPPORTED_CAPABILITY", "the Nexus runtime needs the native storageDomain service; it never keeps Nexus state in a private fallback");
	const root = ctx.root;
	const pending = runtimeOpens.get(root);
	if (pending !== void 0) return pending;
	const opening = createRuntime(ctx, config, () => {
		if (runtimeOpens.get(root) === opening) runtimeOpens.delete(root);
	});
	runtimeOpens.set(root, opening);
	try {
		return await opening;
	} catch (error) {
		if (runtimeOpens.get(root) === opening) runtimeOpens.delete(root);
		throw error;
	}
}
/**
* In-flight and live runtime per root context, so two rows cannot open two stores.
*
* This is an identity guard, not Nexus state: durable records live in the store
* and the write-authority table lives in the coordinator.
*/
const runtimeOpens = /* @__PURE__ */ new WeakMap();
/**
* Freeze one JSON value, so a published snapshot cannot be edited by a reader.
* @param value - JSON data owned by the runtime.
* @returns the same value, frozen at every level.
*/
function deepFreeze(value) {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const member of Object.values(value)) deepFreeze(member);
	return value;
}
/**
* Freeze one stored record together with its hash.
* @param record - the record and hash the store returned.
* @returns the immutable snapshot.
*/
function frozenRecord(record) {
	return Object.freeze({
		value: deepFreeze(record.value),
		hash: record.hash
	});
}
/**
* Read one failure as a short line for the teardown report.
* @param error - whatever a disposer or the medium rejected with.
* @returns its message.
*/
function describeFailure(error) {
	return error instanceof Error ? error.message : String(error);
}
/** One open runtime; constructed only by {@link createRuntime}. */
var NexusRuntimeHandle = class {
	store;
	coordinator;
	prompts;
	webResults;
	deployment;
	detachService;
	onClosed;
	committed;
	/** Exact Agents this host composed as Nexus actors. */
	members = /* @__PURE__ */ new Set();
	/** Managed-resource fact providers of the live generations. */
	resourceFacts = [];
	/** Unconfirmed report details a retired generation handed to this runtime. */
	retainedResources = [];
	/** Exact Agents whose ranges a retired generation could not prove empty. */
	retainedAgents = /* @__PURE__ */ new Set();
	/** Reports already folded into the teardown status (identity dedupe). */
	recordedReports = /* @__PURE__ */ new Set();
	/** Nexus-owned resources, drained most recent first. */
	resources = [];
	closing = false;
	disposed = false;
	disposal;
	/**
	* @param parts - the shared members this runtime owns and its release hooks.
	*/
	constructor(parts) {
		this.store = parts.store;
		this.coordinator = parts.coordinator;
		this.prompts = parts.prompts;
		this.webResults = parts.webResults;
		this.deployment = parts.deployment;
		this.committed = parts.initial;
		this.detachService = parts.detachService;
		this.onClosed = parts.onClosed;
	}
	getSettings() {
		this.assertOpen("read the Nexus settings");
		return this.committed;
	}
	assertAvailable() {
		this.assertAdmitting("use the Nexus runtime");
	}
	async saveLibrary(value, expectedHash) {
		this.assertAvailable();
		return this.store.saveLibrary(validatePromptLibrary(value), expectedHash);
	}
	async saveSettings(value, expectedHash) {
		this.assertOpen("save the Nexus settings");
		this.assertAdmitting("save the Nexus settings");
		const saved = frozenRecord(await this.store.saveSettings(value, expectedHash));
		this.committed = saved;
		return saved;
	}
	getShellConfig() {
		this.assertOpen("read the Nexus shell configuration");
		return Object.freeze({
			deployment: this.deployment,
			terminal: this.committed.value.terminal
		});
	}
	markNexusAgent(agent) {
		this.assertAdmitting("mark a Nexus Agent");
		this.members.add(agent);
		let released = false;
		return { release: () => {
			if (released) return;
			released = true;
			this.members.delete(agent);
		} };
	}
	isNexusAgent(agent) {
		return !this.closing && this.members.has(agent);
	}
	attach(label, dispose) {
		this.assertAdmitting(`attach "${label}"`);
		const entry = {
			label,
			dispose
		};
		this.resources.push(entry);
		return () => {
			const index = this.resources.indexOf(entry);
			if (index >= 0) this.resources.splice(index, 1);
		};
	}
	trackManagedResources(facts) {
		this.assertAdmitting("track managed resources");
		const entry = { facts };
		this.resourceFacts.push(entry);
		return () => {
			const index = this.resourceFacts.indexOf(entry);
			if (index >= 0) this.resourceFacts.splice(index, 1);
		};
	}
	reportCleanup(label, report) {
		this.recordReport(label, report);
	}
	/**
	* The cleanup fact for one exact Agent, as this runtime can prove it now.
	* @param agent - the Agent a bound child's write authority belongs to.
	* @returns a retained or tracked `unconfirmed` over `pending` over `clean`.
	*/
	managedCleanupOf(agent) {
		if (this.retainedAgents.has(agent)) return "unconfirmed";
		let state = "clean";
		for (const entry of this.resourceFacts) state = combineManagedCleanup(state, entry.facts.cleanupOf(agent));
		return state;
	}
	/**
	* Record one completed resource report exactly once.
	*
	* The same report object may arrive twice (an attached disposer the runtime
	* drained and the generation that published it), so identity is the dedupe
	* key; unresolved facts it names stay owned by this runtime afterwards.
	* @param label - resource label for the teardown status.
	* @param report - the report to record.
	*/
	recordReport(label, report) {
		if (this.recordedReports.has(report)) return;
		this.recordedReports.add(report);
		if (report.released === false) {
			const detail = report.unconfirmed.map((item) => `${label}: ${item}`);
			this.retainedResources.push(...detail.length > 0 ? detail : [label]);
		}
		for (const agent of report.unresolvedAgents ?? []) this.retainedAgents.add(agent);
	}
	dispose() {
		this.disposal ??= this.runDisposal();
		return this.disposal;
	}
	/**
	* Stop admissions, drain owned resources and pending writes, then close the store.
	*
	* The order is the contract: admissions close synchronously first, accepted work
	* is joined, and only then does the store close. A resource that reports
	* unconfirmed cleanup or a write scope that stayed reserved keeps `released`
	* false, and no failure is converted into success.
	* @returns what the teardown proved.
	*/
	async runDisposal() {
		this.closing = true;
		this.coordinator.closeAdmissions();
		this.prompts.closeAdmissions();
		this.webResults.closeAdmissions();
		const failures = [];
		const unconfirmedResources = [];
		for (const entry of this.resources.splice(0).reverse()) try {
			const report = await entry.dispose();
			if (report !== void 0) this.recordReport(entry.label, report);
		} catch (error) {
			unconfirmedResources.push(entry.label);
			failures.push(`${entry.label}: ${describeFailure(error)}`);
		}
		unconfirmedResources.push(...this.retainedResources);
		try {
			await this.prompts.drain();
		} catch (error) {
			failures.push(`prompt writes: ${describeFailure(error)}`);
		}
		try {
			await this.coordinator.dispose();
		} catch (error) {
			failures.push(`write authority: ${describeFailure(error)}`);
		}
		try {
			await this.webResults.drain();
		} catch (error) {
			failures.push(`saved web results: ${describeFailure(error)}`);
		}
		const retainedScopes = this.coordinator.retainedScopes();
		this.members.clear();
		this.prompts.dispose();
		try {
			await this.store.dispose();
		} catch (error) {
			failures.push(`store: ${describeFailure(error)}`);
		}
		this.disposed = true;
		this.detachService();
		this.onClosed();
		return Object.freeze({
			released: unconfirmedResources.length === 0 && retainedScopes.length === 0 && this.retainedAgents.size === 0 && failures.length === 0,
			unconfirmedResources: Object.freeze(unconfirmedResources),
			retainedScopes,
			failures: Object.freeze(failures)
		});
	}
	/**
	* Refuse a read on a runtime that already closed its store.
	* @param action - what the caller tried, for the message.
	*/
	assertOpen(action) {
		if (this.disposed) throw new NexusError("RESOURCE_NOT_AVAILABLE", `cannot ${action}: this Nexus runtime is already disposed`);
	}
	/**
	* Refuse a new admission while the runtime is shutting down.
	* @param action - what the caller tried, for the message.
	*/
	assertAdmitting(action) {
		if (this.closing) throw new NexusError("RESOURCE_NOT_AVAILABLE", `cannot ${action}: this Nexus runtime is shutting down and admits no new Nexus work`);
	}
};
/**
* Open the store, load durable write authority and build the one runtime handle.
* @param host - the host row's context; it owns the store and the service.
* @param config - deployment configuration for the row.
* @param onClosed - called once the runtime closed, to forget its identity.
* @returns the runtime, published as `nexusRuntime`.
*/
async function createRuntime(host, config, onClosed) {
	const store = await openNexusStore(host, { disposeOnUnload: false });
	let facts = { cleanupOf: () => "unconfirmed" };
	const coordinator = createWriteCoordinator(host, createStoreWriteScopeJournal(store), { cleanupOf: (agent) => facts.cleanupOf(agent) });
	let detachService;
	let handle;
	const prompts = { value: void 0 };
	try {
		await coordinator.restore();
		const initial = frozenRecord(await store.readSettings());
		prompts.value = createPromptSessions(host, store);
		handle = new NexusRuntimeHandle({
			deployment: deepFreeze({ ...config }),
			store,
			coordinator,
			prompts: prompts.value,
			webResults: createWebResultRepository(store),
			initial,
			detachService: () => {
				detachService?.();
			},
			onClosed
		});
		facts = { cleanupOf: (agent) => handle.managedCleanupOf(agent) };
	} catch (error) {
		prompts.value?.dispose();
		await coordinator.dispose().catch(() => void 0);
		await store.dispose().catch(() => void 0);
		throw error;
	}
	try {
		detachService = host.provide(NEXUS_RUNTIME_SERVICE, handle);
		host.effect(() => () => handle.dispose(), NEXUS_RUNTIME_SERVICE);
	} catch (error) {
		await handle.dispose().catch(() => void 0);
		throw error;
	}
	return handle;
}
const BODY_TIMEOUT_MS = 1e4;
/** Sanitized failures owned by the HTTP boundary, never infrastructure text. */
var HttpError = class extends Error {
	status;
	code;
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
};
/** Validate an actual peer plus a local authority and, when present, exact origin. */
function guardConsoleTransport(facts) {
	const refuse = () => {
		throw new HttpError(403, "UNSAFE_CALLER", "A local same-origin caller is required.");
	};
	if (facts.remoteAddress === void 0 || !isLoopbackHost(facts.remoteAddress)) refuse();
	if (facts.host === void 0 || !/^(localhost|127(?:\.\d{1,3}){3}|\[[a-fA-F0-9:.]+\])(?::[0-9]+)?$/.test(facts.host)) refuse();
	let authority;
	try {
		authority = new URL(`${facts.protocol}//${facts.host}`);
	} catch {
		return refuse();
	}
	const hostname = authority.hostname.replace(/^\[|\]$/g, "");
	if (hostname !== "localhost" && !isLoopbackHost(hostname)) refuse();
	const port = Number(authority.port || (facts.protocol === "https:" ? 443 : 80));
	if (facts.localPort === void 0 || port !== facts.localPort) refuse();
	if (facts.fetchSite !== void 0 && facts.fetchSite !== "same-origin" && facts.fetchSite !== "none") refuse();
	if (facts.origin !== void 0) {
		let origin;
		try {
			origin = new URL(facts.origin);
		} catch {
			return refuse();
		}
		if (facts.origin !== origin.origin || origin.origin !== authority.origin) refuse();
	}
}
/** Reject duplicate sensitive headers, including Node's normally coalesced ones. */
function singleHeader(req, name) {
	let count = 0;
	for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i]?.toLowerCase() === name) count++;
	const value = req.headers[name];
	if (count > 1 || Array.isArray(value)) throw new HttpError(403, "UNSAFE_CALLER", "Ambiguous request headers are not allowed.");
	return value;
}
function guardConsoleRequest(req, protocol) {
	guardConsoleTransport({
		remoteAddress: req.socket.remoteAddress,
		localPort: req.socket.localPort,
		protocol,
		host: singleHeader(req, "host"),
		origin: singleHeader(req, "origin"),
		fetchSite: singleHeader(req, "sec-fetch-site")
	});
}
/** All writes require both an instance-bound secret and unambiguous JSON. */
function guardConsoleWrite(req, token) {
	const supplied = Buffer.from(singleHeader(req, "x-nexus-csrf") ?? "", "utf8");
	const expected = Buffer.from(token, "utf8");
	if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpError(403, "INVALID_CSRF", "A current Nexus CSRF token is required.");
	const type = singleHeader(req, "content-type");
	if (type === void 0 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type)) throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json with UTF-8.");
	if (req.headers["content-encoding"] !== void 0) throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Content encoding is not supported.");
}
/** Bounded raw-byte reader; cancellation never waits for an unfinished client. */
function readConsoleJson(req, signal) {
	const length = singleHeader(req, "content-length");
	if (length !== void 0 && (!/^\d+$/.test(length) || Number(length) > 262144)) throw new HttpError(413, "BODY_TOO_LARGE", "The request body exceeds 256 KiB.");
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		const cleanup = () => {
			clearTimeout(timer);
			req.off("data", onData);
			req.off("end", onEnd);
			req.off("aborted", onAbort);
			req.off("error", onAbort);
			signal.removeEventListener("abort", onClose);
		};
		const fail = (error) => {
			cleanup();
			req.pause();
			reject(error);
		};
		const onData = (chunk) => {
			size += chunk.length;
			if (size > 262144) {
				fail(new HttpError(413, "BODY_TOO_LARGE", "The request body exceeds 256 KiB."));
				return;
			}
			chunks.push(chunk);
		};
		const onEnd = () => {
			cleanup();
			try {
				const text = new TextDecoder("utf-8", {
					fatal: true,
					ignoreBOM: true
				}).decode(Buffer.concat(chunks, size));
				resolve(JSON.parse(text));
			} catch {
				reject(new HttpError(400, "INVALID_REQUEST", "A valid UTF-8 JSON body is required."));
			}
		};
		const onAbort = () => fail(new HttpError(400, "INVALID_REQUEST", "The request body was interrupted."));
		const onClose = () => fail(new HttpError(503, "RESOURCE_NOT_AVAILABLE", "The Nexus API is closing."));
		const timer = setTimeout(() => fail(new HttpError(408, "REQUEST_TIMEOUT", "The request body timed out.")), BODY_TIMEOUT_MS);
		timer.unref();
		req.on("data", onData);
		req.once("end", onEnd);
		req.once("aborted", onAbort);
		req.once("error", onAbort);
		signal.addEventListener("abort", onClose, { once: true });
		if (signal.aborted) onClose();
		else if (req.aborted || req.destroyed) onAbort();
	});
}
// src/http/capabilities.ts
function inspectService(resolve, enumerate) {
	let service;
	try {
		service = resolve();
	} catch {
		return {
			service: "unknown",
			backends: {
				state: "unknown",
				names: null
			},
			readiness: "unverified"
		};
	}
	if (service === void 0) return {
		service: "absent",
		backends: {
			state: "absent",
			names: []
		},
		readiness: "unverified"
	};
	const uninspectable = {
		service: "present",
		backends: {
			state: "unknown",
			names: null
		},
		readiness: "unverified"
	};
	if (enumerate === void 0) return uninspectable;
	try {
		const names = enumerate(service);
		if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) return uninspectable;
		return {
			service: "present",
			backends: {
				state: names.length === 0 ? "absent" : "registered",
				names: [...names]
			},
			readiness: "unverified"
		};
	} catch {
		return uninspectable;
	}
}
/** Synchronous route ids only; initial console load never interrogates adapters. */
function inspectModelProviders(ctx) {
	try {
		return ctx.get("llm")?.listProviders().map((provider) => provider.id) ?? [];
	} catch {
		return [];
	}
}
/** Advisory, lazy model ids owned by one HTTP registration. Same-provider calls
* join the underlying adapter operation, even after a caller's 1.5s wait ends:
* the SDK cannot cancel listModels. Only adapter settlement releases the entry.
* Never forward adapter metadata or errors; completed results are not cached. */
function createModelInspector(ctx) {
	const inFlight = /* @__PURE__ */ new Map();
	return async (provider) => {
		let timer;
		try {
			const llm = ctx.get("llm");
			if (llm === void 0) return [];
			let lookup = inFlight.get(provider);
			if (lookup === void 0) {
				lookup = Promise.resolve().then(() => llm.listModels(provider)).then((models) => models.map((model) => model.id)).catch(() => []).finally(() => {
					inFlight.delete(provider);
				});
				inFlight.set(provider, lookup);
			}
			return await Promise.race([lookup, new Promise((resolve) => {
				timer = setTimeout(() => resolve([]), 1500);
			})]);
		} catch {
			return [];
		} finally {
			clearTimeout(timer);
		}
	};
}
/** Re-read optional public registries on each guarded request. ctx.get does not
* require the optional service to activate the host or expose private fields. */
function inspectBackendRegistrations(ctx) {
	return {
		scope: "effective-http-context",
		terminal: inspectService(() => ctx.get("terminals"), (service) => service.listBackends()),
		web: inspectService(() => ctx.get("web")),
		internalAgent: inspectService(() => ctx.get("subagents"), (service) => service.list())
	};
}
// src/http/routes.ts
/** Guarded Node HTTP console. No model-facing tool, second runtime or private store. */
const saveShape = z.strictObject({
	value: z.unknown(),
	expectedHash: z.string().min(1)
});
const previewShape = z.strictObject({
	library: z.unknown(),
	selection: z.array(z.string())
});
const applyShape = z.strictObject({
	selection: z.array(z.string()),
	expectedLibraryHash: z.string().min(1)
});
function parse(schema, value) {
	const result = schema.safeParse(value);
	if (!result.success) throw new HttpError(400, "INVALID_REQUEST", "The request has invalid or unknown fields.");
	rejectUnknownFields(value, result.data);
	return result.data;
}
/** Reuse the stored settings schema's rules, but refuse fields it would strip.
* This keeps recovery reads unchanged and avoids a second settings validator. */
function rejectUnknownFields(input, parsed) {
	if (input === parsed) return;
	if (input === null || typeof input !== "object" || parsed === null || typeof parsed !== "object") return;
	const allowed = parsed;
	for (const [key, value] of Object.entries(input)) {
		if (!Object.hasOwn(allowed, key)) throw new HttpError(400, "INVALID_REQUEST", "Unknown request fields are not allowed.");
		rejectUnknownFields(value, allowed[key]);
	}
}
/** Native titles are log-only session/title events, not creation metadata. */
function sessionTitle(agent) {
	const data = agent.session.snapshotEvents().findLast((entry) => entry.type === "session/title")?.data;
	return data !== null && typeof data === "object" && "title" in data && typeof data.title === "string" ? data.title : "";
}
function send(res, status, value) {
	if (res.destroyed || res.writableEnded) return;
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
		"Connection": "close"
	});
	res.end(JSON.stringify(value));
}
function httpFailure(error) {
	if (error instanceof HttpError) return error;
	if (error instanceof NexusError) switch (error.code) {
		case "CONFIG_CONFLICT": return new HttpError(409, error.code, "The saved record changed. Read it again before retrying.");
		case "INVALID_ARGUMENT": return new HttpError(400, error.code, "The prompt library or selection is invalid.");
		case "NO_AGENT": return new HttpError(404, error.code, "The exact live Nexus session is not available.");
		case "RESOURCE_NOT_AVAILABLE": return new HttpError(503, error.code, "The Nexus runtime is not available.");
		case "UNSUPPORTED_CAPABILITY": return new HttpError(503, error.code, "A required Nexus capability is not available.");
	}
	return new HttpError(500, "INTERNAL_ERROR", "The Nexus operation failed.");
}
/** Register within a scope injected with webServer and agents. Every activation
* owns one unpredictable token. Both scope unload and runtime drain retire it. */
function registerRoutes(ctx, runtime) {
	const token = randomBytes(32).toString("hex");
	const closing = new AbortController();
	const inspectModelIds = createModelInspector(ctx);
	let unregister;
	let detachRuntime;
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		closing.abort();
		unregister?.();
		detachRuntime?.();
	};
	const assertAvailable = () => {
		if (disposed) throw new HttpError(503, "RESOURCE_NOT_AVAILABLE", "The Nexus API is closing.");
		runtime.assertAvailable();
	};
	const assertActor = (agent) => {
		assertAvailable();
		if (agent === void 0 || ctx.agents.get(agent.id) !== agent || !runtime.isNexusAgent(agent)) throw new HttpError(404, "NO_AGENT", "The exact live Nexus session is not available.");
		return agent;
	};
	const route = {
		kind: "prefix",
		path: NEXUS_API_PREFIX,
		handler: async (req, res) => {
			try {
				guardConsoleRequest(req, ctx.webServer.protocol);
				assertAvailable();
				const url = new URL(req.url ?? "/", ctx.webServer.getOrigin());
				const path = url.pathname.slice(14);
				const modelProvider = url.searchParams.get("provider")?.trim();
				if (url.search !== "" && (path !== "/capabilities" || modelProvider === void 0 || modelProvider === "" || [...url.searchParams.keys()].length !== 1 || modelProvider.length > 256)) throw new HttpError(400, "INVALID_REQUEST", "Only one provider query on capabilities is supported.");
				const targetPath = /^\/session-keys\/~([^/]*)\/prompt$/.exec(path) ?? /^\/sessions\/([^/]+)\/prompt$/.exec(path);
				const methods = path === "/library" || path === "/settings" ? ["GET", "PUT"] : path === "/prompts/preview" ? ["POST"] : targetPath !== null ? ["GET", "POST"] : path === "/capabilities" || path === "/sessions" ? ["GET"] : void 0;
				if (methods === void 0) throw new HttpError(404, "NOT_FOUND", "The Nexus route does not exist.");
				if (!methods.includes(req.method ?? "")) {
					res.setHeader("Allow", methods.join(", "));
					throw new HttpError(405, "METHOD_NOT_ALLOWED", "The request method is not allowed.");
				}
				const writing = req.method === "PUT" || req.method === "POST";
				if (writing) guardConsoleWrite(req, token);
				else if (req.headers["transfer-encoding"] !== void 0 || req.headers["content-length"] !== void 0 && req.headers["content-length"] !== "0") throw new HttpError(400, "INVALID_REQUEST", "GET requests must not carry a body.");
				let actor;
				if (targetPath !== null) {
					let id;
					try {
						id = decodeURIComponent(targetPath[1]);
					} catch {
						throw new HttpError(400, "INVALID_REQUEST", "The session id is malformed.");
					}
					actor = assertActor(ctx.agents.get(SessionId(id)));
				}
				const body = writing ? await readConsoleJson(req, closing.signal) : void 0;
				assertAvailable();
				if (req.aborted || res.destroyed) throw new HttpError(400, "INVALID_REQUEST", "The caller disconnected.");
				let result;
				if (path === "/library") {
					if (writing) {
						const input = parse(saveShape, body);
						result = await runtime.saveLibrary(validatePromptLibrary(input.value), input.expectedHash);
					} else result = await runtime.store.readLibrary();
				} else if (path === "/settings") {
					if (writing) {
						const input = parse(saveShape, body);
						result = await runtime.saveSettings(parse(runtimeSettingsSchema, input.value), input.expectedHash);
					} else result = runtime.getSettings();
				} else if (path === "/prompts/preview") {
					const input = parse(previewShape, body);
					const modules = selectedPromptModules(validatePromptLibrary(input.library), input.selection);
					result = {
						selection: input.selection,
						modules,
						text: composePromptText(modules)
					};
				} else if (path === "/sessions") result = ctx.agents.list().filter((agent) => ctx.agents.get(agent.id) === agent && runtime.isNexusAgent(agent)).map((agent) => ({
					id: agent.id,
					title: sessionTitle(agent)
				}));
				else if (targetPath !== null) {
					const exact = assertActor(actor);
					if (writing) {
						const input = parse(applyShape, body);
						result = await runtime.prompts.apply(exact, input.selection, input.expectedLibraryHash, () => {
							assertActor(exact);
						});
					} else result = runtime.prompts.peek(exact);
				} else if (modelProvider !== void 0) {
					result = { models: await inspectModelIds(modelProvider) };
					assertAvailable();
				} else result = {
					csrfToken: token,
					verification: "unverified",
					registered: {
						consoleApi: true,
						nexusRuntime: true
					},
					backendRegistrations: inspectBackendRegistrations(ctx),
					providers: inspectModelProviders(ctx),
					diagnostics: ["Registration only; OS backends, providers, accounts and GUI have not been verified."],
					settingsLocation: {
						namespace: "dsh-nexus",
						domain: NEXUS_DOMAIN_NAME
					},
					basePrompt: BASE_PROMPT
				};
				send(res, 200, result);
			} catch (error) {
				const failure = httpFailure(error);
				send(res, failure.status, { error: {
					code: failure.code,
					message: failure.message
				} });
			}
		}
	};
	ctx.effect(() => {
		try {
			detachRuntime = runtime.attach("console-http", dispose);
			unregister = ctx.webServer.register(route);
		} catch (error) {
			dispose();
			throw error;
		}
		return dispose;
	}, "dsh-nexus console HTTP");
	return dispose;
}
// src/index.ts
/** Loader row id; mirrors the package name and `cordis.patch.yml`. */
const name = "dsh-nexus";
/**
* Services this row needs before it may activate.
*
* `storageDomain` comes from the runtime opener's own cold path; `agentPresets`
* is the registry the preset definition is declared into. A row that activated
* without them would throw mid-composition and leave the deployment without a
* runtime, so both are declared rather than discovered.
*/
const inject = [...NEXUS_RUNTIME_INJECT, "agentPresets"];
/**
* Host-half entry point.
*
* @param ctx - host plugin context; it owns the shared runtime and the
*   registered preset definition. It owns no terminal capability: each preset
*   generation mounts the native terminal service and its backends in its own
*   isolated scope (see `preset/index.ts`).
* @param config - validated deployment configuration for the row.
* @throws NexusError when the native storage service is missing, when the
*   inherited compaction capability is ambiguous, or when the preset definition
*   cannot be mounted.
*/
async function apply(ctx, config) {
	const runtime = await openNexusRuntime(ctx, config);
	ctx.inject(["webServer", "agents"], (scope) => {
		registerRoutes(scope, runtime);
	});
	const definition = createNexusPreset(config, detectNativeComposition(ctx));
	const unregister = await ctx.agentPresets.register(definition);
	ctx.effect(() => unregister, "dsh-nexus preset definition");
}
export { Config, apply, inject, name };

//# sourceMappingURL=index.js.map