# Select the Core version

Choose the Core release before running `create`. Use the exact release number in `npx @agent-native/core@<core-version> create ...`.

1. Check the [official versioning policy](https://www.agent-native.com/docs/versioning-and-stability/), current [setup prerequisites](https://www.agent-native.com/docs/), and published release tags. Prefer the current stable release for a new project. Select an older release when an existing workspace or a documented compatibility issue requires it. Use a nightly or prerelease only when a required capability needs it. Confirm that the release supports the planned template, workspace shape, and client or embedded-agent integration; read its release notes and version-matched documentation when a feature or API changed.
2. Check the available Node.js version against the selected release's `engines` requirement. Check the generated package manager requirement before installation. If the project must share framework packages or source with an existing Agent Native workspace, inspect that workspace's installed Core version and select a compatible release.
3. Record the selected release and the reason for it in the setup handoff. The version in the `npx` command selects the generator's templates and instructions and becomes the generated project's exact `@agent-native/core` dependency. Existing apps keep their installed versions. Installation resolves the generated dependency specifications; other `@agent-native/*` packages can use separate versions or ranges, so inspect the generated manifests and lockfile.

Use these read-only registry checks to resolve a release tag and its Node.js requirement:

```bash
npm view @agent-native/core dist-tags --json
npm view @agent-native/core@<core-version> engines --json
```

Keep the generated Core pin. For later changes, use the target release's [upgrade procedure](https://www.agent-native.com/docs/versioning-and-stability/) and inspect its preview and migration notes. An upgrade changes framework packages and scaffold skills; use [template sync](https://www.agent-native.com/docs/syncing-template-changes/) to review and merge newer first-party template files. Continue application work with the documentation bundled with the installed Core version.
