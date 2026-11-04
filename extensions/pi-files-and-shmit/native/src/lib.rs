//! Native ast-grep module for the pi-files-and-shmit extension.
//!
//! Adapts the public `pi-ast` API from oh-my-pi to **synchronous** N-API
//! functions. Upstream's higher-level native bindings wrap the work in
//! `task::Promise` + `task::CancelToken` (which pulls tokio); we drop that
//! wrapper and run on the JS main thread. File sources are small in
//! interactive use, so blocking is acceptable, and the JS side owns
//! cancellation by not calling further after `signal` aborts.
//!
//! Three entry points are exported:
//!   - `astMatch`       — in-memory pattern search.
//!   - `resolveLanguage`— path/alias → canonical language name.
//!   - `astRewrite`     — in-memory pattern→rewrite, returning
//!                        per-match changes + the materialized rewritten
//!                        source (the JS `ast_edit` tool layers `dryRun`/
//!                        apply + a TOCTOU content-hash re-check on top).
//!
//! File discovery, globbing, candidate collection, and result aggregation
//! live in TypeScript (`src/ast-grep.ts`, `src/ast-edit.ts`) over
//! `glob`/`minimatch`; this crate owns only the N-API contract and
//! extension-specific result shaping.

use std::collections::HashMap;
use std::path::Path;

use ast_grep_core::{
    source::Edit,
    tree_sitter::{LanguageExt, StrDoc},
    Position,
};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use upstream_pi_ast::{ops, SupportLang};

const DEFAULT_FIND_LIMIT: u32 = 50;

/// ast-grep pattern strictness (controls how patterns match syntax). Mirrors
/// upstream `AstMatchStrictness`; the JS-facing string values (`cst`, `smart`,
/// …) match upstream so models see a familiar surface.
#[napi(string_enum)]
pub enum AstMatchStrictness {
    #[napi(value = "cst")]
    Cst,
    #[napi(value = "smart")]
    Smart,
    #[napi(value = "ast")]
    Ast,
    #[napi(value = "relaxed")]
    Relaxed,
    #[napi(value = "signature")]
    Signature,
    #[napi(value = "template")]
    Template,
}

impl From<AstMatchStrictness> for ops::AstMatchStrictness {
    fn from(value: AstMatchStrictness) -> Self {
        match value {
            AstMatchStrictness::Cst => Self::Cst,
            AstMatchStrictness::Smart => Self::Smart,
            AstMatchStrictness::Ast => Self::Ast,
            AstMatchStrictness::Relaxed => Self::Relaxed,
            AstMatchStrictness::Signature => Self::Signature,
            AstMatchStrictness::Template => Self::Template,
        }
    }
}

/// One ast-grep match with source range and optional meta-variables. Mirrors
/// upstream `AstFindMatch`. When produced by `ast_match` (no file context)
/// `path` is the empty string; the JS-side `ast_grep` tool fills it with the
/// file's display path.
#[napi(object)]
pub struct AstFindMatch {
    pub path: String,
    pub text: String,
    pub byte_start: u32,
    pub byte_end: u32,
    pub start_line: u32,
    pub start_column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub meta_variables: Option<HashMap<String, String>>,
}

/// Result of an in-memory `ast_match` run.
#[napi(object)]
pub struct AstMatchResult {
    pub matches: Vec<AstFindMatch>,
    pub total_matches: u32,
    pub limit_reached: bool,
    pub parse_errors: Option<Vec<String>>,
}

/// Options for `astMatch`: run ast-grep patterns against an in-memory source
/// string instead of files on disk. `signal`/`timeoutMs` from upstream are
/// dropped — the sync entry point cannot honor them, and the JS-side tool
/// owns cancellation.
#[napi(object)]
pub struct AstMatchOptions {
    /// Source code to match against (parsed in memory, never read from disk).
    pub source: String,
    /// Language of `source` (required; e.g. "ts", "tsx", "rust", "python").
    pub lang: String,
    /// ast-grep patterns to search for (OR across patterns).
    pub patterns: Vec<String>,
    /// Rule selector for multi-rule ast-grep configurations.
    pub selector: Option<String>,
    /// Pattern strictness; defaults to smart matching when omitted.
    pub strictness: Option<AstMatchStrictness>,
    /// Maximum matches to return after `offset` (default applies when omitted).
    pub limit: Option<u32>,
    /// Number of leading matches to skip before applying `limit`.
    pub offset: Option<u32>,
    /// When true, include meta-variable bindings per match.
    pub include_meta: Option<bool>,
}

fn to_u32(value: usize) -> u32 {
    value.min(u32::MAX as usize) as u32
}

fn char_column(position: Position, node: &ast_grep_core::Node<'_, StrDoc<SupportLang>>) -> usize {
    position.column(node)
}

fn normalize_pattern_list(patterns: Vec<String>) -> std::result::Result<Vec<String>, String> {
    let mut normalized = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for raw in patterns {
        let pattern = raw.trim();
        if pattern.is_empty() {
            continue;
        }
        if seen.insert(pattern.to_string()) {
            normalized.push(pattern.to_string());
        }
    }
    if normalized.is_empty() {
        return Err(
            "`patterns` is required and must include at least one non-empty pattern".to_string(),
        );
    }
    Ok(normalized)
}

/// Match ast-grep patterns against an in-memory source string. Synchronous
/// (no `task::Promise`); see the module docs for the rationale.
#[napi]
pub fn ast_match(options: AstMatchOptions) -> Result<AstMatchResult> {
    let AstMatchOptions {
        source,
        lang,
        patterns,
        selector,
        strictness,
        limit,
        offset,
        include_meta,
    } = options;

    let normalized_limit = limit.unwrap_or(DEFAULT_FIND_LIMIT).max(1);
    let normalized_offset = offset.unwrap_or(0);
    let include_meta = include_meta.unwrap_or(false);
    let strictness = ops::resolve_strictness(strictness.map(Into::into));
    let patterns = normalize_pattern_list(patterns).map_err(Error::from_reason)?;

    let lang_str = lang.trim();
    if lang_str.is_empty() {
        return Err(Error::from_reason(
            "`lang` is required for ast_match".to_string(),
        ));
    }
    let language =
        ops::resolve_supported_lang(lang_str).map_err(|err| Error::from_reason(err.to_string()))?;

    let mut parse_errors: Vec<String> = Vec::new();
    let mut compiled_patterns: Vec<ast_grep_core::matcher::Pattern> =
        Vec::with_capacity(patterns.len());
    for pattern in &patterns {
        match ops::compile_pattern(pattern, selector.as_deref(), &strictness, language) {
            Ok(compiled) => compiled_patterns.push(compiled),
            Err(err) => parse_errors.push(format!("{pattern}: {err}")),
        }
    }

    let mut all_matches: Vec<AstFindMatch> = Vec::new();
    let mut total_matches = 0u32;
    if !compiled_patterns.is_empty() {
        let ast = language.ast_grep(&source);
        if ast.root().dfs().any(|node| node.is_error()) {
            parse_errors.push("parse error (syntax tree contains error nodes)".to_string());
        }
        for pattern in &compiled_patterns {
            for matched in ast.root().find_all(pattern.clone()) {
                total_matches = total_matches.saturating_add(1);
                let range = matched.range();
                let start = matched.start_pos();
                let end = matched.end_pos();
                let meta_variables = if include_meta {
                    Some(HashMap::<String, String>::from(matched.get_env().clone()))
                } else {
                    None
                };
                all_matches.push(AstFindMatch {
                    path: String::new(),
                    text: matched.text().into_owned(),
                    byte_start: to_u32(range.start),
                    byte_end: to_u32(range.end),
                    start_line: to_u32(start.line().saturating_add(1)),
                    start_column: to_u32(char_column(start, matched.get_node()).saturating_add(1)),
                    end_line: to_u32(end.line().saturating_add(1)),
                    end_column: to_u32(char_column(end, matched.get_node()).saturating_add(1)),
                    meta_variables,
                });
            }
        }
    }

    all_matches.sort_by(|left, right| {
        left.start_line
            .cmp(&right.start_line)
            .then(left.start_column.cmp(&right.start_column))
            .then(left.end_line.cmp(&right.end_line))
            .then(left.end_column.cmp(&right.end_column))
            .then(left.byte_start.cmp(&right.byte_start))
            .then(left.byte_end.cmp(&right.byte_end))
    });

    let visible_matches = all_matches
        .into_iter()
        .skip(normalized_offset as usize)
        .collect::<Vec<_>>();
    let limit_reached = visible_matches.len() > normalized_limit as usize;
    let matches = visible_matches
        .into_iter()
        .take(normalized_limit as usize)
        .collect::<Vec<_>>();

    Ok(AstMatchResult {
        matches,
        total_matches,
        limit_reached,
        parse_errors: (!parse_errors.is_empty()).then_some(parse_errors),
    })
}

/// Resolve a language for a file path, optionally overriding with an explicit
/// `lang` alias. Returns the canonical language name (e.g. `make`, `rust`).
/// Delegates to `pi-ast::ops::resolve_language` so the JS scanner does not
/// reimplement the upstream language registry in TypeScript.
#[napi]
pub fn resolve_language(file_path: String, lang: Option<String>) -> Result<String> {
    let language = ops::resolve_language(lang.as_deref(), Path::new(&file_path))
        .map_err(|err| Error::from_reason(err.to_string()))?;
    Ok(language.canonical_name().to_string())
}

/// One pattern→rewrite rule for `ast_rewrite`. Mirrors a single entry of
/// upstream `astEdit`'s `rewrites` map; flattened to a struct so the napi
/// boundary is order-stable (a `HashMap` would reorder across calls).
#[napi(object)]
pub struct AstRewriteRule {
    /// ast-grep pattern locating nodes to replace.
    pub pattern: String,
    /// Replacement template (may reference captured meta-variables).
    pub rewrite: String,
}

/// Options for `astRewrite`: apply pattern→rewrite rules to an in-memory
/// source string. The JS-side `ast_edit` tool calls this per file and owns
/// file discovery, `dryRun`/apply, and the TOCTOU content-hash re-check.
#[napi(object)]
pub struct AstRewriteOptions {
    /// Source code to rewrite (parsed in memory, never read from disk).
    pub source: String,
    /// Language of `source` (required; e.g. "ts", "tsx", "rust", "python").
    pub lang: String,
    /// Pattern→rewrite rules. At least one is required.
    pub rewrites: Vec<AstRewriteRule>,
    /// Rule selector for multi-rule ast-grep configurations.
    pub selector: Option<String>,
    /// Pattern strictness; defaults to smart matching when omitted.
    pub strictness: Option<AstMatchStrictness>,
    /// Cap on total replacements collected from this source. Defaults to
    /// u32::MAX (all matches). Mirrors upstream `max_replacements`.
    pub max_replacements: Option<u32>,
}

/// One textual replacement computed by `astRewrite` (before/after slice and
/// coordinates). Mirrors upstream `AstReplaceChange` minus the `path` field
/// (the JS tool fills the path, as it does for `ast_match`).
#[napi(object)]
pub struct AstRewriteChange {
    /// Original matched text.
    pub before: String,
    /// Replacement text (meta-variables already substituted).
    pub after: String,
    /// Start byte offset of the replaced span.
    pub byte_start: u32,
    /// End byte offset of the replaced span (exclusive).
    pub byte_end: u32,
    /// 1-based start line of the match.
    pub start_line: u32,
    /// 1-based start column.
    pub start_column: u32,
    /// 1-based end line.
    pub end_line: u32,
    /// 1-based end column.
    pub end_column: u32,
}

/// Result of an in-memory `astRewrite` run. `rewritten_source` is `None` when
/// the per-match edits overlap (upstream rejects overlaps) or no edits applied;
/// the JS apply step treats `None` on a file with `replacements > 0` as a
/// hard error, while `dryRun` still surfaces the per-match `changes`.
#[napi(object)]
pub struct AstRewriteResult {
    /// Individual replacement records (per match, in source order).
    pub changes: Vec<AstRewriteChange>,
    /// Materialized rewritten source, or `None` when edits overlapped / none.
    pub rewritten_source: Option<String>,
    /// Total replacements collected (capped by `max_replacements`).
    pub replacements: u32,
    /// True when `max_replacements` stopped further collection.
    pub limit_reached: bool,
    /// Pattern-compile / overlap / parse errors when not failing the call.
    pub parse_errors: Option<Vec<String>>,
}

/// Apply pattern→rewrite rules to an in-memory source string and return the
/// per-match changes plus the materialized rewritten source. Synchronous.
///
/// Adapts the per-file inner loop of upstream `ast_edit_blocking`: one parse,
/// collect `replace_by` edits across all rules against that single tree, then
/// materialize via `apply_edits` (rejecting overlaps). The JS-side `ast_edit`
/// tool layers file discovery, `dryRun`/apply, and the TOCTOU content-hash
/// re-check on top.
#[napi]
pub fn ast_rewrite(options: AstRewriteOptions) -> Result<AstRewriteResult> {
    let AstRewriteOptions {
        source,
        lang,
        rewrites,
        selector,
        strictness,
        max_replacements,
    } = options;

    let max_replacements = max_replacements.unwrap_or(u32::MAX).max(1) as usize;
    let strictness = ops::resolve_strictness(strictness.map(Into::into));

    let lang_str = lang.trim();
    if lang_str.is_empty() {
        return Err(Error::from_reason(
            "`lang` is required for ast_rewrite".to_string(),
        ));
    }
    let language =
        ops::resolve_supported_lang(lang_str).map_err(|err| Error::from_reason(err.to_string()))?;

    // Normalize rewrite rules: trim, drop empty patterns, dedupe (pattern,rewrite).
    let mut normalized_rules: Vec<(String, String)> = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for rule in rewrites {
        let pattern = rule.pattern.trim();
        if pattern.is_empty() {
            continue;
        }
        if seen.insert((pattern.to_string(), rule.rewrite.clone())) {
            normalized_rules.push((pattern.to_string(), rule.rewrite));
        }
    }
    if normalized_rules.is_empty() {
        return Err(Error::from_reason(
            "`rewrites` is required and must include at least one non-empty pattern".to_string(),
        ));
    }

    let mut parse_errors: Vec<String> = Vec::new();
    let mut compiled_rules: Vec<(String, ast_grep_core::matcher::Pattern)> = Vec::new();
    for (pattern, rewrite) in &normalized_rules {
        match ops::compile_pattern(pattern, selector.as_deref(), &strictness, language) {
            Ok(compiled) => compiled_rules.push((rewrite.clone(), compiled)),
            Err(err) => parse_errors.push(format!("{pattern}: {err}")),
        }
    }

    let mut changes: Vec<AstRewriteChange> = Vec::new();
    let mut edits: Vec<Edit<String>> = Vec::new();
    let mut limit_reached = false;

    if !compiled_rules.is_empty() {
        let ast = language.ast_grep(&source);
        if ast.root().dfs().any(|node| node.is_error()) {
            // Match upstream `ast_edit_blocking` (ast.rs:962-970): a file whose
            // syntax tree contains error nodes is SKIPPED, not partially
            // rewritten. Record the parse issue and return the unchanged source
            // with zero replacements, so the JS layer's preview/apply treats this
            // file as untouched (not as an affected file with a stale plan).
            parse_errors.push("parse error (syntax tree contains error nodes)".to_string());
            return Ok(AstRewriteResult {
                changes,
                rewritten_source: Some(source),
                replacements: 0,
                limit_reached: false,
                parse_errors: (!parse_errors.is_empty()).then_some(parse_errors),
            });
        }
        'rewrite: for (rewrite, compiled) in &compiled_rules {
            for matched in ast.root().find_all(compiled.clone()) {
                if changes.len() >= max_replacements {
                    limit_reached = true;
                    break 'rewrite;
                }
                let edit = matched.replace_by(rewrite.as_str());
                let range = matched.range();
                let start = matched.start_pos();
                let end = matched.end_pos();
                let after = String::from_utf8(edit.inserted_text.clone()).map_err(|err| {
                    Error::from_reason(format!("Replacement text is not valid UTF-8: {err}"))
                })?;
                changes.push(AstRewriteChange {
                    before: matched.text().into_owned(),
                    after,
                    byte_start: to_u32(range.start),
                    byte_end: to_u32(range.end),
                    start_line: to_u32(start.line().saturating_add(1)),
                    start_column: to_u32(char_column(start, matched.get_node()).saturating_add(1)),
                    end_line: to_u32(end.line().saturating_add(1)),
                    end_column: to_u32(char_column(end, matched.get_node()).saturating_add(1)),
                });
                edits.push(edit);
            }
        }
    }

    let replacements = to_u32(changes.len());
    let rewritten_source = if edits.is_empty() {
        // No matches: the source is unchanged. Return it so the JS layer can
        // treat "rewritten_source is None" unambiguously as an error state.
        Some(source.clone())
    } else {
        match ops::apply_edits(&source, &edits) {
            Ok(output) => Some(output),
            Err(err) => {
                parse_errors.push(format!("failed to materialize edits: {err}"));
                None
            }
        }
    };

    Ok(AstRewriteResult {
        changes,
        rewritten_source,
        replacements,
        limit_reached,
        parse_errors: (!parse_errors.is_empty()).then_some(parse_errors),
    })
}
