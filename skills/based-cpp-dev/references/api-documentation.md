# C and C++ API documentation

Apply the shared API documentation contract from based-software-dev. Use Doxygen syntax for C and C++ documentation comments.

## Layout

1. Write the summary with `@brief`.
2. Put callable-wide contract details after the summary. Use `@details` when an explicit section improves the generated output.
3. Write preconditions with `@pre` and postconditions with `@post` as callable-wide contract details.
4. Write one `@tparam name description` entry per template parameter in declaration order.
5. Write one `@param[in]`, `@param[out]`, or `@param[in,out]` entry per explicit parameter in declaration order.
6. Write `@return` for the successful result's general meaning. Write one `@retval` entry per discrete result whose value selects an outcome.
7. Write error codes as `@retval` entries. Use `@throws` only when an existing C++ interface exposes an exception to its caller.
8. Write one example with `@code` and `@endcode` when an example applies.

For pointer and buffer parameters, state nullability, element or byte units, ownership, valid extent, and permitted mutation when the declaration does not express them.

```cpp
/**
 * @brief Copies a record into caller-provided storage.
 *
 * The function leaves @p storage unchanged when the record does not exist or
 * the storage is too small.
 *
 * @pre @p storage points to at least @p storage_size writable bytes.
 * @param[in] record_id Identifier of the record to copy.
 * @param[out] storage Writable storage that receives the record bytes.
 * @param[in] storage_size Available storage size in bytes.
 * @return Number of bytes written on success.
 * @retval -ENOENT The record does not exist.
 * @retval -ENOSPC The storage is smaller than the record.
 */
std::ptrdiff_t CopyRecord(
    RecordId record_id,
    std::byte* storage,
    std::size_t storage_size) noexcept;
```
