# C++ project configuration

Use `CMakeLists.txt` as the baseline build configuration. Apply this template when initializing a project, replace each placeholder, and remove targets that the project does not use:

```cmake
cmake_minimum_required(VERSION <minimum-version>)

project(project_name
    VERSION 0.1.0
    LANGUAGES CXX
)

add_library(project_name
    src/project_name.cpp
)

target_include_directories(project_name
    PUBLIC
        "${CMAKE_CURRENT_SOURCE_DIR}/include"
)

target_compile_features(project_name
    PUBLIC
        cxx_std_<version>
)

include(CTest)

if(BUILD_TESTING)
    find_package(GTest REQUIRED)

    add_executable(project_name_tests
        tests/project_name_test.cpp
    )

    target_link_libraries(project_name_tests
        PRIVATE
            project_name
            GTest::gtest
            GTest::gmock
            GTest::gtest_main
    )

    include(GoogleTest)
    gtest_discover_tests(project_name_tests)
endif()
```

- Select the minimum CMake version from project and dependency requirements.
- Select the C++ standard from confirmed project requirements and apply it with `target_compile_features`.
- Use `PUBLIC`, `PRIVATE`, and `INTERFACE` to state how each usage requirement applies to the target and its consumers.
- List source files explicitly for each target.
- Use CTest and `gtest_discover_tests` to register GoogleTest cases.
- Preserve the project dependency lockfile when the selected dependency manager provides one.

Copy [the clang-format configuration](../assets/clang-format.yaml) to `.clang-format` at the project root.

Use `PackArguments` and `PackParameters` directly when the project requires clang-format 23 or later. 

```yaml
PackArguments:
  BinPack: BinPack
PackConstructorInitializers: NextLine
PackParameters:
  BinPack: BinPack
```

For an earlier required version, replace `PackArguments` with `BinPackArguments: true` and `PackParameters` with `BinPackParameters: true`. Validate the complete configuration with the selected clang-format executable.

Add `CommentPragmas`, `MacroBlockBegin`, `MacroBlockEnd`, or `NamespaceMacros` only when the project defines behavior for them.
