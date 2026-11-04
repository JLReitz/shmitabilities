# Python API documentation

Apply the shared API documentation contract from based-software-dev. Use PEP 257 docstrings with Google-style sections.

## Layout

1. Write a one-line summary in triple double quotes.
2. Separate callable-wide contract details from the summary with one blank line.
3. Write `Args:` with one entry per caller-supplied parameter in declaration order. Name variadic parameters as `*args` and `**kwargs`.
4. Write `Returns:` for a returned value or `Yields:` for values produced by a generator. Describe each discrete result condition in that section.
5. Write `Raises:` with one entry per exposed exception type.
6. Write `Example:` when an example applies.

State a parameter or return type only when an annotation does not state it. Omit `Returns:` for a function that returns only `None`.

Omit `self` and `cls` from `Args:`. State receiver state requirements in the callable-wide details.

```python
from typing import Optional


def load_record(record_id: RecordId) -> Optional[RecordData]:
    """Load a record from persistent storage.

    The operation does not modify the stored record.

    Args:
        record_id: Identifier of the record to load.

    Returns:
        The stored record, or None when the record does not exist.

    Raises:
        StorageUnavailableError: Persistent storage cannot complete the request.
    """
```
