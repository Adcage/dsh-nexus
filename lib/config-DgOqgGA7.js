import { HarnessError } from "@deepseek-ai/dsh-llm";
import { realpath } from "node:fs/promises";
import { sep } from "node:path";
import { SessionId } from "@deepseek-ai/dsh-session";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { gfm } from "@joplin/turndown-plugin-gfm";
import TurndownService from "turndown";
import z from "@deepseek-ai/schemastery";
// src/runtime/errors.ts
/**
* The Nexus failure vocabulary, carried on DSH's standard error channel.
*
* Every Nexus failure is a {@link HarnessError} subclass so the tool registry's
* `isError` result keeps `{ name, code }` for retry, permission and UI layers
* without anyone parsing a message. The codes are the stable contract from the
* plan's shared section; a native failure (for example `FsError`) is never
* rewrapped, so its own code and reason reach the caller unchanged.
*
* @module dsh-nexus/runtime/errors
*/
/**
* One Nexus failure. The class name is the reported `name`, so callers can tell
* a Nexus decision from a native service error that passed through.
*/
var NexusError = class extends HarnessError {
	/**
	* @param code - stable failure class from {@link NexusErrorCode}.
	* @param message - model-facing explanation, never a stack trace.
	* @param options - standard error options (`cause`).
	*/
	constructor(code, message, options) {
		super(message, code, options);
	}
};
// src/agent/coordination.ts
/**
* Exclusive write scopes for internal children (AG-08).
*
* A scope is the directory tree a child can ACTUALLY write: the native
* `workspace-write` root its session resolves, not the subdirectory it happens
* to use as a working directory. Two children of one delegating session share
* that root, so they can mutate each other's files no matter how different
* their requested directories look; a second writer over an overlapping root is
* refused with `WRITE_SCOPE_BUSY` before it is admitted.
*
* Scopes are compared after canonicalization, so a spelling difference, a case
* difference on Windows or a junction alias cannot smuggle a second writer into
* one tree. Overlap means identical roots or one root inside the other. Two
* disjoint granted roots — which only two differently authorized sessions can
* own — do not overlap and run side by side; different subdirectories of one
* session's workspace are NOT isolated scopes.
*
* The lease covers only the agent workspace root. The platform's shared scratch
* areas (`tmpdir` and the sandbox backend's temp directory) are not leased and
* are not private per-child isolation; a child that writes there is outside
* this coordination.
*
* The coordinator is an ordinary object owned by the top-level runtime and
* passed to every consumer; it is never a module global, so two sessions and
* two preset generations of the same deployment share one lease table while an
* unloaded plugin cannot leave a live writer in it.
*
* A lease has two lifetimes. An ordinary (`held`) lease belongs to a child the
* runtime published, and it ends on the native `agent/disposed` edge for that
* child or on an explicit {@link WriteLease.release}. A lease whose child start
* rejected with unconfirmed cleanup is marked `unconfirmed` by its owner and has
* NO automatic end: absence of an Agent or a Session, a replaced Agent for the
* same session id, and a later residency's disposal are all negative evidence,
* so none of them may unlock a scope a possibly live writer still uses. Only an
* explicit release ends such a lease. A result, an error, an interrupt
* acknowledgement or an inferred idle state are never release proof either.
*
* The runtime composes this coordinator with a durable journal, so a reservation
* is evidence on the medium before a writer is admitted. Teardown does not clear
* the table: an unresolved reservation survives as a record the next coordinator
* loads and treats as unresolved authority (Task 9). A scope table that was
* cleared, a restarted process and an absent Agent registry are not cleanup
* proof.
*
* @module dsh-nexus/agent/coordination
*/
/**
* Fold one Agent's unresolved ranges into its cleanup fact.
* @param unresolved - every range the controller cannot prove cleaned.
* @param agent - the Agent to answer for.
* @returns `unconfirmed` over `pending` over `clean`.
*/
function managedCleanupStateOf(unresolved, agent) {
	let state = "clean";
	for (const entry of unresolved) {
		if (entry.agent !== agent) continue;
		if (entry.state === "unconfirmed") return "unconfirmed";
		state = "pending";
	}
	return state;
}
/**
* Combine two facts about one Agent, keeping the least proven one.
* @param left - one controller's fact.
* @param right - another controller's fact.
* @returns `unconfirmed` over `pending` over `clean`.
*/
function combineManagedCleanup(left, right) {
	return CLEANUP_RANK[left] >= CLEANUP_RANK[right] ? left : right;
}
/** Ordering that makes "least proven" a comparison. */
const CLEANUP_RANK = Object.freeze({
	clean: 0,
	pending: 1,
	unconfirmed: 2
});
/**
* Canonicalize a directory: resolve junctions, symlinks and real case so two
* spellings of one tree compare equal.
* @param path - absolute directory the model or a caller supplied.
* @returns the canonical absolute directory.
* @throws NexusError `INVALID_ARGUMENT` when the directory does not resolve.
*/
async function canonicalDirectory(path) {
	try {
		return await realpath(path);
	} catch (error) {
		throw new NexusError("INVALID_ARGUMENT", `"${path}" is not an existing directory that can be used as a child workspace`, { cause: error });
	}
}
/**
* Comparison key for one canonical directory. Windows compares paths without
* case; every other platform treats case as significant.
* @param path - canonical absolute directory.
* @returns the key two scopes are compared by.
*/
function directoryKey(path) {
	return process.platform === "win32" ? path.toLowerCase() : path;
}
/**
* Whether one canonical directory is the other or lives inside it.
* @param root - canonical directory treated as the containing scope.
* @param candidate - canonical directory tested against it.
* @returns true when `candidate` is `root` or below it.
*/
function scopeContains(root, candidate) {
	const container = directoryKey(root);
	const inner = directoryKey(candidate);
	if (container === inner) return true;
	const prefix = container.endsWith(sep) ? container : `${container}${sep}`;
	return inner.startsWith(prefix);
}
/**
* Whether two canonical scopes cover any common directory: identical, or one is
* an ancestor of the other.
* @param left - canonical directory.
* @param right - canonical directory.
* @returns true when the two writers would mutate one tree.
*/
function scopesOverlap(left, right) {
	return scopeContains(left, right) || scopeContains(right, left);
}
/**
* Adapt the durable Nexus store to the coordinator's reservation journal.
* @param store - the runtime's one store.
* @returns the journal over the store's reservation table.
*/
function createStoreWriteScopeJournal(store) {
	return {
		list: () => store.listWriteScopes(),
		put: (record) => store.putWriteScope(record),
		delete: (childId) => store.deleteWriteScope(childId)
	};
}
/**
* Create the deployment's write coordinator.
*
* The coordinator releases an ordinary lease when the native runtime disposes the
* child that holds it — the confirmed-release edge, never an inferred idle
* state. It never reclaims one because an Agent is absent or replaced: that is
* the same negative evidence a silently failed rollback leaves behind, so a
* cleanup-unconfirmed reservation stays reserved.
*
* With a journal, every reservation is durable before the child is admitted, so a
* process that stops without a positive release leaves evidence behind. The next
* coordinator loads that evidence as unresolved authority and refuses those trees
* — clearing a scope table is not cleanup proof, and a restart is not one either.
* @param ctx - context that owns the coordinator's lifetime.
* @param journal - durable reservation journal; omitted by a coordinator that owns
*   no cross-restart authority.
* @param facts - host-managed resource facts; when given, a bound child's disposal
*   releases authority only for a proven-clean Agent.
* @returns the coordinator to pass to every child consumer.
*/
function createWriteCoordinator(ctx, journal, facts) {
	const leases = /* @__PURE__ */ new Map();
	/** Agents whose creation this coordinator observed, by exact identity. */
	const createdAgents = /* @__PURE__ */ new WeakSet();
	/** Agents already bound to one reservation; a released residency is never re-bound. */
	const claimedAgents = /* @__PURE__ */ new WeakSet();
	/** Durable failures nobody awaited; surfaced by {@link WriteCoordinator.drain}. */
	const failures = [];
	let closing = false;
	/** Tail of the durable reservation work, in the order the table changed. */
	let journalChain = Promise.resolve();
	/**
	* Queue one durable reservation operation behind the previous one.
	* @param operation - durable step to run.
	* @returns its result; the recorded chain itself never rejects.
	*/
	const enqueue = (operation) => {
		const next = journalChain.then(operation, operation);
		journalChain = next.catch(() => void 0);
		return next;
	};
	/** The one record a child holds, if any. */
	const recordOf = (childId) => {
		for (const record of leases.values()) if (record.childId === childId) return record;
	};
	/**
	* Delete one released reservation durably.
	*
	* The delete is re-checked when it runs: a newer reservation for the same child
	* owns the row by then, so an older release can never delete it.
	* @param record - the record that was released.
	*/
	const persistRelease = (record) => {
		if (journal === void 0) return;
		enqueue(async () => {
			const live = recordOf(record.childId);
			if (live !== void 0 && live !== record) return;
			await journal.delete(record.childId);
		}).catch((error) => {
			failures.push(error);
		});
	};
	/** Release one record after an explicit release or a bound child's disposal. */
	const drop = (record) => {
		if (record.released) return;
		record.released = true;
		if (leases.get(record.key) === record) leases.delete(record.key);
		persistRelease(record);
	};
	/**
	* Bind the reservation to the exact Agent that is its residency.
	* @param record - the reservation.
	* @param childId - child the reservation belongs to.
	*/
	const bindChild = (record, childId) => {
		const live = ctx.get("agents")?.get(childId);
		if (live === void 0 || record.childAgent !== void 0) return;
		if (!createdAgents.has(live) || claimedAgents.has(live)) return;
		record.childAgent = live;
		claimedAgents.add(live);
	};
	const createdListener = ctx.on("agent/created", ({ agent }) => {
		createdAgents.add(agent);
		const record = recordOf(agent.id);
		if (record === void 0 || record.childAgent !== void 0) return void 0;
		if (claimedAgents.has(agent)) return void 0;
		record.childAgent = agent;
		claimedAgents.add(agent);
	});
	const disposeListener = ctx.on("agent/disposed", ({ agent }) => {
		for (const record of [...leases.values()]) {
			if (record.childId !== agent.id) continue;
			if (record.retained || record.state === "unconfirmed") continue;
			if (record.childAgent !== void 0) {
				if (record.childAgent !== agent) continue;
			} else if (createdAgents.has(agent)) continue;
			if (facts !== void 0 && facts.cleanupOf(agent) !== "clean") {
				record.state = "unconfirmed";
				continue;
			}
			drop(record);
		}
	});
	const coordinator = {
		async acquire(owner, childId, cwd) {
			if (closing) throw new NexusError("RESOURCE_NOT_AVAILABLE", "the Nexus write coordinator is shutting down; no new writer is admitted while its reservations drain");
			const root = await canonicalDirectory(cwd);
			const key = directoryKey(root);
			if (closing) throw new NexusError("RESOURCE_NOT_AVAILABLE", "the Nexus write coordinator is shutting down; no new writer is admitted while its reservations drain");
			const current = recordOf(childId);
			if (current?.retained === true) throw new NexusError("WRITE_SCOPE_BUSY", `child "${childId}" still holds the write scope "${current.root}" from a process that stopped without confirming its cleanup; that reservation is retained and never force-unlocked by a restart, so no writer may be admitted into it`);
			for (const record of [...leases.values()]) {
				if (record.childId === childId) continue;
				if (scopesOverlap(record.root, root)) throw new NexusError("WRITE_SCOPE_BUSY", `another child (${record.childId}) already holds the write scope "${record.root}", which overlaps "${root}"; a workspace can have one writer at a time, so wait for that writer to finish`);
			}
			if (current !== void 0) {
				if (current.key === key) return leaseOf(current);
				if (current.state === "unconfirmed") throw new NexusError("WRITE_SCOPE_BUSY", `child "${childId}" still holds the write scope "${current.root}" after a start with unconfirmed cleanup, so that scope cannot be moved or replaced; release or restart the deployment scope to recover it`);
				drop(current);
			}
			const record = {
				owner,
				childId,
				root,
				key,
				state: "held",
				released: false,
				retained: false
			};
			leases.set(key, record);
			if (journal !== void 0) try {
				await enqueue(() => journal.put({
					childId,
					root
				}));
			} catch (error) {
				if (leases.get(key) === record) leases.delete(key);
				record.released = true;
				throw error;
			}
			bindChild(record, childId);
			return leaseOf(record);
		},
		pin(childId) {
			const record = recordOf(childId);
			if (record === void 0 || record.released) return;
			record.state = "unconfirmed";
		},
		scopeOf(childId) {
			const record = recordOf(childId);
			return record === void 0 ? void 0 : {
				root: record.root,
				state: record.state
			};
		},
		closeAdmissions() {
			closing = true;
		},
		async restore() {
			if (journal === void 0) return;
			const records = await journal.list();
			for (const record of records) {
				const key = directoryKey(record.root);
				if (leases.has(key)) continue;
				if (recordOf(SessionId(record.childId)) !== void 0) continue;
				leases.set(key, {
					childId: SessionId(record.childId),
					root: record.root,
					key,
					state: "unconfirmed",
					released: false,
					retained: true
				});
			}
		},
		retainedScopes() {
			return [...leases.values()].filter((record) => !record.released).map((record) => ({
				childId: record.childId,
				root: record.root,
				state: record.state
			}));
		},
		drain() {
			return drainJournal();
		},
		dispose() {
			return dispose();
		}
	};
	/**
	* Wait until every queued reservation operation settled.
	* @throws the first durable failure nobody awaited.
	*/
	async function drainJournal() {
		for (;;) {
			const tail = journalChain;
			await tail;
			if (journalChain === tail) break;
		}
		if (failures.length > 0) throw failures[0];
	}
	let disposal;
	/**
	* Stop admissions, remove both lifecycle listeners and wait for the journal.
	*
	* No reservation is released here: an unresolved scope keeps its durable record
	* so the next runtime refuses its tree instead of trusting an empty table.
	* @returns resolution after the journal settled.
	*/
	function dispose() {
		disposal ??= (async () => {
			closing = true;
			createdListener();
			disposeListener();
			await drainJournal();
		})();
		return disposal;
	}
	ctx.effect(() => () => dispose(), "nexus write coordinator");
	return coordinator;
	/** Project one record into the lease surface a caller holds. */
	function leaseOf(record) {
		return {
			childId: record.childId,
			cwd: record.root,
			release() {
				if (record.released) return;
				drop(record);
			}
		};
	}
}
/** Largest accepted read line count. */
const FILE_READ_MAX_LINES = 2e3;
/** Byte cap of one read result when the settings name no other value. */
const FILE_OUTPUT_DEFAULT_BYTES = 32768;
/** Largest accepted read output cap. */
const FILE_OUTPUT_MAX_BYTES = 32768;
/** Largest accepted total size of an edit call's input. */
const FILE_EDIT_MAX_INPUT_BYTES = 16777216;
/** Timeout of an ordinary command when the call names none. */
const COMMAND_DEFAULT_TIMEOUT_MS = 12e4;
/** Largest accepted command timeout. */
const COMMAND_MAX_TIMEOUT_MS = 6e5;
/** Grace period between a stop request and forced termination. */
const COMMAND_CLEANUP_GRACE_MS = 3e3;
/** In-memory cap of each of stdout and stderr. */
const PROCESS_OUTPUT_MEMORY_BYTES = 32768;
/** Spill file cap of each of stdout and stderr. */
const PROCESS_OUTPUT_SPILL_BYTES = 33554432;
/** Largest text one output read returns. */
const PROCESS_READ_MAX_BYTES = 16384;
/** `wait` duration when the call names none. */
const WAIT_DEFAULT_MS = 1e3;
/** Largest accepted `wait` duration; reaching it never kills the resource. */
const WAIT_MAX_MS = 3e4;
/** Characters per saved page when the settings name no other value. */
const WEB_DEFAULT_CHARS_PER_PAGE = 12e3;
/** Largest accepted characters per saved page. */
const WEB_MAX_CHARS_PER_PAGE = 24e3;
/** Largest accepted stored size of one web document. */
const WEB_DOCUMENT_MAX_BYTES = 8388608;
/** Stored bytes one session's web documents may occupy. */
const WEB_SESSION_MAX_BYTES = 33554432;
/** Retention of one saved web document. */
const WEB_DOCUMENT_RETENTION_MS = 6048e5;
/** Byte cap of the text one `agent read` page returns. */
const AGENT_READ_MAX_BYTES = 16384;
/** Bytes one module body may hold. */
const PROMPT_MODULE_MAX_BYTES = 32768;
/** Bytes all module bodies together may hold. */
const PROMPT_LIBRARY_MAX_BYTES = 131072;
/** Settings served and stored before the user changes anything. */
const DEFAULT_SETTINGS = Object.freeze({
	files: Object.freeze({
		defaultLines: 200,
		maxOutputBytes: FILE_OUTPUT_DEFAULT_BYTES
	}),
	terminal: Object.freeze({ engine: "bash" }),
	agents: Object.freeze({
		concurrency: 4,
		maxDepth: 2,
		childAccess: "inherit"
	}),
	web: Object.freeze({
		maxResults: 5,
		maxCharsPerPage: WEB_DEFAULT_CHARS_PER_PAGE
	}),
	toolDisplay: "nexus"
});
/** Prompt library served and stored before the user adds a module: nothing selected. */
const DEFAULT_LIBRARY = Object.freeze({
	modules: Object.freeze([]),
	defaultSelection: Object.freeze([])
});
// src/web/extract.ts
/**
* What the model actually reads: static HTML→markdown conversion, zero-based
* UTF-16 paging, and literal location over one saved text.
*
* The conversion is deliberately static. Turndown parses the decoded HTML into
* its own DOM and walks it; nothing here evaluates a script, loads a
* subresource, or resolves a URL, and non-visible elements are removed before
* they can contribute their text. Deeply nested markup is refused instead of
* being walked, because the parse cost grows superlinearly and a tool call must
* stay bounded.
*
* Paging and location never lowercase or re-encode the source. A page snaps to
* code-point boundaries and reports the boundaries it actually returned, so a
* caller can concatenate pages without a gap or a repeated character; a
* case-insensitive search matches against the source text itself, so every
* reported offset is a real position in the saved basis.
*
* @module dsh-nexus/web/extract
*/
/**
* Nesting depth above which conversion is refused.
*
* Walking a deeply nested tree synchronously blocks the loop for seconds
* (unclosed tags make the parse superlinear). Real pages nest a few dozen
* levels, so this ceiling only rejects hostile or broken markup.
*/
const MAX_CONVERSION_DEPTH = 512;
/** Elements that never take a closing tag, so they do not grow the stack. */
const VOID_ELEMENTS = /* @__PURE__ */ new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr"
]);
/** Elements whose contents HTML parses as text until the matching end tag. */
const RAW_TEXT_ELEMENTS = /* @__PURE__ */ new Set([
	"script",
	"style",
	"noscript"
]);
/** The shared converter; stateless across calls and safe to reuse. */
const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
	bulletListMarker: "-"
});
turndown.use(gfm);
turndown.addRule("removeNonVisibleContent", {
	filter(node) {
		if ([
			"SCRIPT",
			"STYLE",
			"NOSCRIPT",
			"TEMPLATE",
			"IFRAME",
			"OBJECT",
			"EMBED"
		].includes(node.nodeName)) return true;
		if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden")?.toLowerCase() === "true") return true;
		if (node.nodeName === "INPUT" && node.getAttribute("type")?.toLowerCase() === "hidden") return true;
		return (node.getAttribute("style")?.split(";") ?? []).some((declaration) => {
			const separator = declaration.indexOf(":");
			if (separator === -1) return false;
			const property = declaration.slice(0, separator).trim().toLowerCase();
			const value = declaration.slice(separator + 1).trim().toLowerCase().replace(/\s*!important\s*$/u, "");
			return property === "display" && value === "none" || property === "visibility" && (value === "hidden" || value === "collapse");
		});
	},
	replacement() {
		return "";
	}
});
/** Whether a character can follow a raw-text end-tag name. */
function isTagBoundary(char) {
	return char === void 0 || char === ">" || char === "/" || /\s/u.test(char);
}
/** Find a raw-text end tag without interpreting markup-like body text. */
function findRawTextEnd(lowerHtml, name, from) {
	const prefix = `</${name}`;
	let candidate = lowerHtml.indexOf(prefix, from);
	while (candidate !== -1 && !isTagBoundary(lowerHtml[candidate + prefix.length])) candidate = lowerHtml.indexOf(prefix, candidate + prefix.length);
	return candidate;
}
/**
* Conservatively reject HTML whose lexical element stack crosses the depth
* ceiling.
*
* The single pass ignores comments, skips raw-text bodies, respects quoted `>`
* characters and only counts well-formed tag starts. Mismatched closing tags
* reduce the counter but never below zero, so malformed markup over-counts
* nesting rather than hiding it.
* @param html - the decoded HTML body.
* @returns whether conversion must be refused.
*/
function exceedsConversionDepth(html) {
	const lower = html.toLowerCase();
	let depth = 0;
	let index = 0;
	while (index < lower.length) {
		const open = lower.indexOf("<", index);
		if (open === -1) return false;
		if (lower.startsWith("<!--", open)) {
			const end = lower.indexOf("-->", open + 4);
			if (end === -1) return false;
			index = end + 3;
			continue;
		}
		if (lower[open + 1] === "!" || lower[open + 1] === "?") {
			const end = lower.indexOf(">", open + 2);
			if (end === -1) return false;
			index = end + 1;
			continue;
		}
		if (lower[open + 1] === "/") {
			const end = lower.indexOf(">", open + 2);
			if (end === -1) return false;
			if (/[a-z]/u.test(lower[open + 2] ?? "")) depth = Math.max(0, depth - 1);
			index = end + 1;
			continue;
		}
		if (!/[a-z]/u.test(lower[open + 1] ?? "")) {
			index = open + 1;
			continue;
		}
		let cursor = open + 1;
		const nameStart = cursor;
		while (cursor < lower.length && /[a-z0-9:-]/u.test(lower[cursor] ?? "")) cursor += 1;
		const name = lower.slice(nameStart, cursor);
		let quote;
		while (cursor < lower.length) {
			const char = lower[cursor];
			if (quote !== void 0) {
				if (char === quote) quote = void 0;
			} else if (char === "\"" || char === "'") quote = char;
			else if (char === ">") break;
			cursor += 1;
		}
		if (cursor >= lower.length) return false;
		const selfClosing = lower[cursor - 1] === "/";
		index = cursor + 1;
		if (VOID_ELEMENTS.has(name) || selfClosing) continue;
		depth += 1;
		if (depth > MAX_CONVERSION_DEPTH) return true;
		if (RAW_TEXT_ELEMENTS.has(name)) {
			const end = findRawTextEnd(lower, name, index);
			if (end === -1) return false;
			index = end;
		}
	}
	return false;
}
/**
* Convert an HTML body to readable markdown, or refuse it.
* @param html - decoded HTML body.
* @returns the conversion, or the explicit refusal.
*/
function convertHtmlToText(html) {
	if (exceedsConversionDepth(html)) return {
		skipped: true,
		reason: "too-deep"
	};
	return {
		skipped: false,
		text: turndown.turndown(html)
	};
}
/** Whether a UTF-16 unit is a high surrogate. */
function isHighSurrogate(code) {
	return code >= 55296 && code <= 56319;
}
/** Whether a UTF-16 unit is a low surrogate. */
function isLowSurrogate(code) {
	return code >= 56320 && code <= 57343;
}
/**
* Move a start offset back off the trailing half of a surrogate pair.
* @param text - saved basis text.
* @param offset - candidate UTF-16 offset.
* @returns an offset that never begins inside a pair.
*/
function snapStart(text, offset) {
	const bounded = Math.max(0, Math.min(offset, text.length));
	if (bounded > 0 && bounded < text.length) {
		if (isLowSurrogate(text.charCodeAt(bounded)) && isHighSurrogate(text.charCodeAt(bounded - 1))) return bounded - 1;
	}
	return bounded;
}
/**
* Move an exclusive end offset forward off the leading half of a surrogate pair.
* @param text - saved basis text.
* @param offset - candidate exclusive offset.
* @returns an offset that never ends inside a pair.
*/
function snapEnd(text, offset) {
	const bounded = Math.max(0, Math.min(offset, text.length));
	if (bounded > 0 && bounded < text.length) {
		if (isHighSurrogate(text.charCodeAt(bounded - 1)) && isLowSurrogate(text.charCodeAt(bounded))) return bounded + 1;
	}
	return bounded;
}
/**
* Slice one page out of a saved basis.
*
* `offset` is a zero-based UTF-16 index. The returned page reports the actual
* boundaries: a requested offset inside a surrogate pair starts at the pair, and
* a page ending inside a pair includes the whole pair, so concatenating pages
* reproduces the source exactly.
* @param text - saved basis text.
* @param offset - requested zero-based UTF-16 offset.
* @param limit - maximum UTF-16 units (a completed surrogate pair may add one).
* @returns the bounded page.
*/
function pageText(text, offset, limit) {
	const start = snapStart(text, offset);
	const end = snapEnd(text, Math.min(text.length, start + Math.max(1, limit)));
	return {
		text: text.slice(start, end),
		offset: start,
		endOffset: end,
		nextOffset: end,
		atEnd: end >= text.length
	};
}
/** Escape one literal string for use as a regular expression body. */
function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
/**
* Locate one literal string in the saved basis.
*
* The pattern is built from the escaped literal; a case-insensitive scan adds
* the `i` flag to the pattern rather than lowercasing the source, so match
* offsets stay real source positions. The scan stops one match past the bound,
* which proves that more exist without walking a document that may contain
* millions of hits.
* @param text - saved basis text.
* @param search - literal search text.
* @param caseSensitive - whether case matters.
* @param maxMatches - reported-match bound.
* @param snippetRadius - context kept on each side of a match.
* @returns the bounded matches.
*/
function findText(text, search, caseSensitive, maxMatches, snippetRadius) {
	const matches = [];
	if (search.length === 0) return {
		matches,
		truncated: false,
		scannedTo: 0
	};
	const pattern = new RegExp(escapeRegExp(search), caseSensitive ? "g" : "gi");
	let truncated = false;
	let scannedTo = 0;
	for (;;) {
		const match = pattern.exec(text);
		if (match === null) break;
		if (matches.length >= maxMatches) {
			truncated = true;
			scannedTo = match.index;
			break;
		}
		const start = match.index;
		const end = start + match[0].length;
		const snippetOffset = snapStart(text, Math.max(0, start - snippetRadius));
		const snippetEnd = snapEnd(text, Math.min(text.length, end + snippetRadius));
		matches.push({
			offset: start,
			endOffset: end,
			snippet: text.slice(snippetOffset, snippetEnd),
			snippetOffset
		});
		if (pattern.lastIndex <= start) pattern.lastIndex = start + 1;
	}
	return {
		matches,
		truncated,
		scannedTo
	};
}
/**
* Measure one text in UTF-8 bytes.
* @param text - text to measure.
* @returns its UTF-8 byte length.
*/
function utf8Bytes(text) {
	return Buffer.byteLength(text, "utf8");
}
/**
* Cut one text to a UTF-8 byte budget on a code-point boundary.
* @param text - text to cut.
* @param maxBytes - UTF-8 byte budget.
* @returns the longest prefix that fits without splitting a surrogate pair.
*/
function truncateToUtf8Bytes(text, maxBytes) {
	if (maxBytes <= 0) return "";
	if (utf8Bytes(text) <= maxBytes) return text;
	let low = 0;
	let high = text.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (utf8Bytes(text.slice(0, mid)) <= maxBytes) low = mid;
		else high = mid - 1;
	}
	let end = low;
	if (end > 0 && end < text.length) {
		if (isHighSurrogate(text.charCodeAt(end - 1)) && isLowSurrogate(text.charCodeAt(end))) end -= 1;
	}
	return text.slice(0, end);
}
// src/web/results.ts
/**
* Durable web results: publication, retention and lookup.
*
* Two rules drive this module. A result id is only ever handed out *after* the
* medium accepted the record, so a failed write can never look like a readable
* document. And a publication first makes room — it purges expired records,
* then evicts the oldest until the owner's count and byte caps hold — instead of
* publishing an over-cap record or claiming capacity it does not have.
*
* Publications for one durable owner are serialized through a promise chain
* held by this repository, so two parallel saves of the same batch cannot both
* observe "one slot free" and exceed the cap. Ownership is the durable session
* id; the caller's live Agent is verified by the tool at the request and
* publication boundaries, never here.
*
* @module dsh-nexus/web/results
*/
/** The production retention limits, in one place. */
const DEFAULT_WEB_RETENTION_LIMITS = Object.freeze({
	maxDocumentBytes: WEB_DOCUMENT_MAX_BYTES,
	maxDocuments: 32,
	maxBytes: WEB_SESSION_MAX_BYTES,
	retentionMs: WEB_DOCUMENT_RETENTION_MS
});
/**
* Measure one record's actual stored footprint.
*
* The whole JSON record is measured, so a duplicate text field (raw content and
* its conversion, or an upstream summary) and the metadata count exactly as
* they are stored — the same number retention enforces and the medium holds.
* @param document - one saved document.
* @returns its UTF-8 byte length as JSON.
*/
function savedFootprint(document) {
	return Buffer.byteLength(JSON.stringify(document), "utf8");
}
/** Resolve which saved text a document's id addresses. */
function basisOf(document) {
	switch (document.textBasis) {
		case "converted-text":
			if (document.convertedText !== void 0) return {
				basis: "converted-text",
				text: document.convertedText
			};
			return {
				basis: "content",
				text: document.content
			};
		case "summary": return {
			basis: "summary",
			text: document.summary ?? ""
		};
		default: return {
			basis: document.textBasis,
			text: document.content
		};
	}
}
/** The failure a missing, expired or foreign result id reports. */
function unavailable(resultId) {
	return new NexusError("RESOURCE_NOT_AVAILABLE", `the saved web result "${resultId}" is not available for this session: it was never saved, expired, or was evicted by retention; obtain it again with search or fetch`);
}
/** One repository instance; constructed by {@link createWebResultRepository}. */
var WebResultRepositoryHandle = class {
	store;
	now;
	limits;
	/** Tail of the publication chain of each owner. */
	publishing = /* @__PURE__ */ new Map();
	/** Whether new publications are refused; set before a teardown drains. */
	admissionsClosed = false;
	/**
	* @param store - the durable store.
	* @param options - clock and limits.
	*/
	constructor(store, options = {}) {
		this.store = store;
		this.now = options.now ?? (() => /* @__PURE__ */ new Date());
		this.limits = options.limits ?? DEFAULT_WEB_RETENTION_LIMITS;
	}
	async save(input) {
		if (this.admissionsClosed) throw new NexusError("RESOURCE_NOT_AVAILABLE", "the Nexus runtime is shutting down and admits no new saved web result");
		return this.serialize(input.owner, () => this.publish(input));
	}
	async read(owner, resultId) {
		const document = await this.store.getWeb(owner, resultId);
		if (document === void 0) throw unavailable(resultId);
		if (!this.isLive(document)) throw unavailable(resultId);
		const { basis, text } = basisOf(document);
		return {
			document,
			basis,
			text
		};
	}
	closeAdmissions() {
		this.admissionsClosed = true;
	}
	async drain() {
		while (this.publishing.size > 0) await Promise.all([...this.publishing.values()]);
	}
	/** Whether a record is still inside its retention window. */
	isLive(document) {
		const expiresAt = Date.parse(document.expiresAt);
		return Number.isFinite(expiresAt) && expiresAt > this.now().getTime();
	}
	/**
	* Serialize publications for one durable owner.
	*
	* The chain is kept per repository instance; every save of one owner waits for
	* the previous one to settle (successfully or not), so two parallel saves can
	* never both see the same free slot.
	*/
	serialize(owner, operation) {
		const run = (this.publishing.get(owner) ?? Promise.resolve()).then(operation, operation);
		const settled = run.then(() => void 0, () => void 0);
		this.publishing.set(owner, settled);
		settled.then(() => {
			if (this.publishing.get(owner) === settled) this.publishing.delete(owner);
		});
		return run;
	}
	/** Make room under the owner's caps, then publish exactly one document. */
	async publish(input) {
		const now = this.now();
		const record = this.fit({
			owner: input.owner,
			resultId: `web-${randomUUID()}`,
			kind: input.kind,
			source: input.source,
			...input.url === void 0 ? {} : { url: input.url },
			...input.query === void 0 ? {} : { query: input.query },
			content: input.content,
			...input.summary === void 0 ? {} : { summary: input.summary },
			...input.convertedText === void 0 ? {} : { convertedText: input.convertedText },
			textBasis: input.textBasis,
			...input.conversionSkipped === true ? { conversionSkipped: true } : {},
			upstreamTruncated: input.upstreamTruncated,
			savedTruncated: false,
			createdAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + this.limits.retentionMs).toISOString()
		});
		const existing = await this.store.listWeb(input.owner);
		const kept = [];
		for (const document of existing) if (this.isLiveAt(document, now.getTime())) kept.push(document);
		else await this.store.deleteWeb(document.owner, document.resultId);
		let total = kept.reduce((sum, document) => sum + savedFootprint(document), 0);
		let victim = 0;
		while (kept.length - victim >= this.limits.maxDocuments || total + savedFootprint(record) > this.limits.maxBytes) {
			const evicted = kept[victim];
			if (evicted === void 0) throw new NexusError("RESOURCE_NOT_AVAILABLE", "the saved web result cannot be published: the owner size limits cannot accommodate it");
			await this.store.deleteWeb(evicted.owner, evicted.resultId);
			total -= savedFootprint(evicted);
			victim += 1;
		}
		await this.store.putWeb(record);
		return record;
	}
	/** Whether a record was still inside its retention window at one instant. */
	isLiveAt(document, time) {
		const expiresAt = Date.parse(document.expiresAt);
		return Number.isFinite(expiresAt) && expiresAt > time;
	}
	/**
	* Cut one over-cap document down to the caps at safe boundaries.
	*
	* Only the saved basis is prioritized: the conversion (or the summary) keeps
	* the budget first and the duplicate raw field takes what is left, so the text
	* `read`/`find` address always stays a contiguous prefix of what was obtained.
	* A cut record is marked `savedTruncated`.
	*/
	fit(record) {
		const cap = Math.min(this.limits.maxDocumentBytes, this.limits.maxBytes);
		if (savedFootprint(record) <= cap) return record;
		let allowed = cap - savedFootprint({
			...record,
			content: "",
			summary: void 0,
			convertedText: void 0,
			savedTruncated: true
		});
		if (allowed <= 0) throw new NexusError("UNSUPPORTED_CAPABILITY", `the web document limit (${cap} bytes) is too small to store any document`);
		let candidate = this.cut(record, allowed);
		for (let attempt = 0; attempt < 4 && savedFootprint(candidate) > cap; attempt += 1) {
			allowed -= savedFootprint(candidate) - cap;
			if (allowed <= 0) break;
			candidate = this.cut(record, allowed);
		}
		if (savedFootprint(candidate) > cap) throw new NexusError("UNSUPPORTED_CAPABILITY", "the obtained web text cannot be stored under the web document limit");
		return candidate;
	}
	/** Build one saved-truncated record whose stored text fits `allowed` bytes. */
	cut(record, allowed) {
		const truncated = {
			...record,
			savedTruncated: true
		};
		switch (record.textBasis) {
			case "summary": return {
				...truncated,
				summary: truncateToUtf8Bytes(record.summary ?? "", allowed)
			};
			case "converted-text": {
				const converted = truncateToUtf8Bytes(record.convertedText ?? "", allowed);
				const remaining = allowed - utf8Bytes(converted);
				return {
					...truncated,
					convertedText: converted,
					content: remaining > 0 ? truncateToUtf8Bytes(record.content, remaining) : ""
				};
			}
			default: return {
				...truncated,
				content: truncateToUtf8Bytes(record.content, allowed)
			};
		}
	}
};
/**
* Create the durable web-result repository over one store.
* @param store - the opened Nexus store.
* @param options - clock and retention limits.
* @returns the repository.
*/
function createWebResultRepository(store, options = {}) {
	return new WebResultRepositoryHandle(store, options);
}
// src/config.ts
/**
* Deployment configuration for the `dsh-nexus` Loader row.
*
* A Loader entry's `Config` is also its settings namespace, which is why the row
* id, the host `name` and this schema's owner all read `dsh-nexus`. Only values
* that are fixed for the installation belong here: the default executables of the
* two supported shells. Which engine a call uses, and any per-installation
* override of these paths, is a stored setting (`RuntimeSettings.terminal`),
* because the console changes it while the plugin runs.
*
* @module dsh-nexus/config
*/
/** Schemastery schema cordis validates the row's `config` against. */
const Config = z.object({
	bashPath: z.string().description("Bash executable used when the terminal settings name none"),
	pwshPath: z.string().description("PowerShell 7 executable used when the terminal settings name none")
});
export { canonicalDirectory as C, managedCleanupStateOf as D, createWriteCoordinator as E, scopeContains as O, WEB_MAX_CHARS_PER_PAGE as S, createStoreWriteScopeJournal as T, PROCESS_READ_MAX_BYTES as _, pageText as a, WAIT_DEFAULT_MS as b, COMMAND_DEFAULT_TIMEOUT_MS as c, DEFAULT_SETTINGS as d, FILE_EDIT_MAX_INPUT_BYTES as f, PROCESS_OUTPUT_SPILL_BYTES as g, PROCESS_OUTPUT_MEMORY_BYTES as h, findText as i, NexusError as k, COMMAND_MAX_TIMEOUT_MS as l, FILE_READ_MAX_LINES as m, createWebResultRepository as n, AGENT_READ_MAX_BYTES as o, FILE_OUTPUT_MAX_BYTES as p, convertHtmlToText as r, COMMAND_CLEANUP_GRACE_MS as s, Config as t, DEFAULT_LIBRARY as u, PROMPT_LIBRARY_MAX_BYTES as v, combineManagedCleanup as w, WAIT_MAX_MS as x, PROMPT_MODULE_MAX_BYTES as y };

//# sourceMappingURL=config-DgOqgGA7.js.map