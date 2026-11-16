# API documentation

An **API documentation comment** is the caller-facing contract attached to a function, method, or callable type. A Python docstring, Doxygen comment, TSDoc comment, and rustdoc comment are language-native forms of this contract.

Document every public callable. Document a nonpublic callable when its name and signature do not state enough information to call it correctly.

## Information order

Write each applicable part in this order:

1. **Summary**: State the observable purpose in one sentence.
2. **Details**: State preconditions, postconditions, caller-visible side effects, ownership, lifetime, and other contract information that applies to the callable as a whole. For a stateful query, list the operations that set, clear, or preserve the queried state.
3. **Parameters**: List caller-supplied parameters in declaration order. State each parameter's purpose and any valid range, unit, direction, ownership, mutation, nullability, or default behavior that the signature does not express. Put implicit-receiver constraints in the details.
4. **Successful result**: State the meaning of a returned or yielded value. State the conditions for both values of a Boolean result and for each success value of a status result.
5. **Failure outcomes**: State the condition that produces each caller-visible failure status, error value, exception, panic, or safety condition.
6. **Example**: Include one example when the preceding contract does not make correct use clear.

Omit a part that does not apply. Do not repeat parameter types, return types, default expressions, or other information already stated completely by the signature.

Use the language skill's API documentation reference for native syntax and language-defined failure sections.
