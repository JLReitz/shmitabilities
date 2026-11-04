# C++20 features

Use C++20 features only when the project's selected standard and supported compilers provide them. Consider portability to each supported environment.

## Concepts and constraints

- Prefer an equivalent standard-library concept to a type trait. Prefer the `template<Concept T>` form or `requires(Condition)` to legacy metaprogramming such as `std::enable_if` or the `template<Concept T>` form.
- Reuse existing concepts and traits. Define a new concept only in library-internal code, and only when the compiler can enforce its requirements.
- Keep requirements that the compiler cannot enforce in comments, assertions, or tests.

Use designated initializers in declaration order, as required by C++20.
