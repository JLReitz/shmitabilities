---
name: based-cpp-dev
description: Apply project C++ conventions and based defaults when creating or modifying C++ source or Doxygen API documentation. Read the version-specific references for C++17 or C++20 features.
---

# Based C++ development

Apply the `based-software-dev` skill to C++ design and implementation.

## Style

In an existing project, follow its established naming, brace, formatting, and documentation-tag conventions where they differ from this section. Apply this section to new projects and to conventions that an existing project does not define.

Use the Google C++ Style Guide as the baseline.

- Use Allman braces.
- Use braced initialization.
- Give numeric literals suffixes that express their intended type.
- When an enumeration has a neutral value, place it first. Value initialization and default mock actions produce the first enumerator.
- List every enumerator in a `switch`. Omit `default` for an `enum class`; include `default` for an unscoped `enum`.

### Class layout

- Group data members by the state they describe. Order constructor initializers to match the member declarations.
- Give every data member a documentation comment that identifies the state, resource, or value it stores.
- Separate adjacent member-function declarations with one blank line.
- Group constructors together and assignment operators together, including deleted and defaulted declarations. Separate the destructor and each group with one blank line.

Read [C++17 features](references/cpp17-features.md) when using C++17 features. Read [C++20 features](references/cpp20-features.md) when using C++20 features.

### API documentation

Read [C and C++ API documentation](references/api-documentation.md) when creating or modifying Doxygen comments in C or C++ source.

Put the complete virtual-operation contract on its abstract interface declaration. Use `@copydoc` on overrides and add only implementation-specific contract details.

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

Every abstract interface shall:
- Expose only pure virtual operation methods.
- Contain no data members.
- Declare its default constructor as `protected`.
- Declare its default copy and move constructors as `protected`.
- Declare its `&`-qualified copy and move assignment operators as `protected`.
- Declare its nonvirtual destructor as `protected`.

Prevent callers from deleting an implementation through its parent interface pointer by declaring a nonvirtual destructor as `protected` in every abstract interface.

- Protected default copy and move constructors.
- Protected `&`-qualified copy and move assignment operators.

Mark all overrides with `override`. Declare every implementation that is not extended as `final`.

## C API handles

Use the C API's opaque pointer type at the dependency seam.

Document whether each handle parameter or result is borrowed, transferred, or nullable.

Release a newly acquired handle inside the acquisition function when later setup fails before ownership transfers.

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
