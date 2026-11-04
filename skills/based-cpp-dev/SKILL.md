---
name: based-cpp-dev
description: Apply Google C++ style with the based naming conventions when creating or modifying C++ source, or Doxygen API documentation for C and C++. Read the version-specific references for C++17 or C++20 features.
---

# Based C++ development

Apply the `based-software-dev` skill to C++ design and implementation.

## Style

Use the Google C++ Style Guide as the baseline for development with the following practices overriding where they conflict.

- Use Allman braces.
- Use braced initialization.
- Give numeric literals suffixes that express their intended type.

Read [C++17 features](references/cpp17-features.md) when using C++17 features. Read [C++20 features](references/cpp20-features.md) when using C++20 features.

Read [C and C++ API documentation](references/api-documentation.md) when creating or modifying Doxygen comments in C or C++ source.

### Formatting

- Format C and C++ with `clang-format`.
- Configure `clang-format` with `BasedOnStyle: Google` and `BreakBeforeBraces: Allman`.
- Run `clang-format -i <files>` to write formatting changes and `clang-format --dry-run --Werror <files>` to check formatting.

### Naming

- Prefix nonconstant data members with `m_`, constants with `k`, and enum values with `e`.
- Append `T` to type template parameter names and `V` to non-type template parameter names.
- Name stateless types such as traits and metafunctions in `snake_case`, consistent with the standard library.

## Project configuration

Apply [C++ project configuration](references/project-configuration.md) when creating or modifying `CMakeLists.txt` or `.clang-format`.

## Polymorphism

Callers must not be able to delete an implementation through its interface, every abstract interface shall declare:
- A protected default constructor.
- A protected non-virtual destructor.
- Protected default copy and move constructors.
- Protected `&`-qualified copy and move assignment operators.

Mark all overrides with `override`. Declare every implementation that is not extended as `final`.

## Errors

Avoid raising exceptions, any external dependencies that do must be wrapped by a try-catch clause at all call points. Mark all functions and methods that do not throw with `noexcept`.

Evaluate ABI and platform assumptions as `static_assert` with a message.

Copy `errno` in to a `const` local immediately after a system call reports failure and evaluate it only from there.

Discard unused returns with `static_cast<void>(...)`.

## Tests

- Use GoogleTest and GoogleMock.
- Use `ASSERT_*` for setup preconditions and `EXPECT_*` for outcome checks.
- Implement data-driven suites with GoogleTest value-parameterized tests.
- Declare GoogleMock implementations in shared headers grouped by production component.
