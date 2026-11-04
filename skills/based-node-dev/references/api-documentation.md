# TypeScript API documentation

Apply the shared API documentation contract from based-software-dev. Use TSDoc syntax for TypeScript documentation comments.

## Layout

1. Write the summary as the first paragraph without a tag.
2. Write callable-wide contract details in `@remarks`.
3. Write one `@param name - description` block per caller-supplied parameter in declaration order.
4. Write the successful result and each discrete result condition in `@returns`.
5. Write one `@throws` block per exposed exception type. Configure the project's TSDoc tooling to accept the extended `@throws` tag when the tool requires a tag declaration.
6. Write one `@example` block when an example applies.

Describe a `Promise` result as the value produced when the promise fulfills. State promise rejection conditions with `@throws`.

```typescript
/**
 * Loads a record from persistent storage.
 *
 * @remarks
 * The operation does not modify the stored record.
 *
 * @param recordId - Identifier of the record to load
 * @returns The stored record, or `undefined` when the record does not exist
 *
 * @throws {@link StorageUnavailableError}
 * Thrown when persistent storage cannot complete the request.
 */
export declare function loadRecord(
    recordId: RecordId,
): Promise<RecordData | undefined>;
```
