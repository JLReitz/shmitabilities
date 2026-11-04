# Rust API documentation

Apply the shared API documentation contract from based-software-dev. Use rustdoc comments and Markdown sections.

## Layout

1. Write the summary as the first paragraph.
2. Put callable-wide contract details after the summary.
3. Write `# Arguments` with one bullet per caller-supplied parameter in declaration order.
4. Write `# Returns` for a non-unit result and state each discrete result condition there.
5. Write `# Errors` for `Result::Err` conditions, `# Panics` for caller-relevant panic conditions, and `# Safety` for invariants that the caller of an unsafe function must uphold.
6. Write `# Examples` with one runnable doctest when an example applies.

Do not repeat types from the signature. Describe the semantic value produced by an iterator under `# Returns`; describe iterator-time failures in the applicable failure section.

Omit `self` receivers from `# Arguments`. State receiver state requirements in the callable-wide details.

```rust
/// Loads a record from persistent storage.
///
/// The operation does not modify the stored record.
///
/// # Arguments
///
/// * `record_id` - Identifier of the record to load.
///
/// # Returns
///
/// The stored record, or `None` when the record does not exist.
///
/// # Errors
///
/// Returns [`StorageError::Unavailable`] when persistent storage cannot
/// complete the request.
pub fn load_record(
    record_id: RecordId,
) -> Result<Option<RecordData>, StorageError>;
```
