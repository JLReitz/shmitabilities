# C++17 features

Use C++17 features only when the project's selected standard and supported compilers provide them. Consider portability to each supported environment.

For class template argument deduction, use a template only when its maintainers provide an explicit deduction guide. Treat standard-library templates as opted in. Keep the deduced type clear to the reader.
