# Create an Agent Native workspace

1. Select the registered agent workspace with `shmitty-project-manager`. Choose the new project's parent directory and name. Read the applicable `AGENTS.md`, inspect the parent repository boundaries, and confirm the target path does not exist. Keep an existing source tree intact; use its own setup instructions when the target already contains a project.
2. Choose the multi-app or standalone shape from [workspace layout](standard-layout.md) and the initial templates. Select an exact Core release with [Core version selection](core-version-selection.md). Check the selected release's prerequisites against the available Node.js and package manager versions. Obtain approval before using pnpm or changing a system-wide installation; keep the generator's package manager and lockfile format. Check example layouts against the selected release's output.
3. Change to the target's parent directory and run one command with the chosen version and name:

   ```bash
   npx @agent-native/core@<core-version> create <workspace-name> --template dispatch,chat
   npx @agent-native/core@<core-version> create <app-name> --template chat --standalone
   ```

   Use the first command for the depicted Dispatch and Chat workspace. The explicit two-template selection creates a multi-app workspace; a single explicit template creates a standalone app unless `--standalone` is supplied. With no `--template`, the generator asks how to start, and its Chat choice creates a standalone app. For another multi-app selection, include `dispatch` and the desired supported templates, then inspect its complete generated layout.

4. Enter the generated project root. Map its app roots and workspace directories to [workspace layout](standard-layout.md). Account for template-specific directories, and inspect the generated routing files before editing them. Inspect the root and app `package.json` files, including the Core pin, other `@agent-native/*` dependency specifications, and scaffold provenance when present. Read the generated instructions and `.env.example`. Use `shmitty-project-manager` to complete Git and project knowledge setup before editing generated files.
5. Verify that Git ignores `.env` with `git check-ignore -v .env`; add `/.env` to `.gitignore` and check again if needed. Store required credentials in that ignored file or a scoped secret store. With pnpm approval, run `pnpm install` and `pnpm dev` from the generated root. Inspect the lockfile for the resolved framework versions, keep it, and confirm the development server reports its address and the app opens.
6. Stop the server after the smoke check. Run the generated typecheck command and `pnpm exec agent-native doctor` from each app root. If a generated script or command differs, use the installed Core documentation and record the command that passed. Record provider-dependent checks as unverified until credentials and provider access are available.
7. Follow [client and embedded agent integration](client-integration.md) for the selected clients. Use `based-harness-dev` to verify each client's project guidance and skill discovery. Configure MCP access or an in-app harness only when the new app needs that connection; check the required Core module and optional packages before installation.
8. Use `beads-task-tracking` to connect the project database. Confirm the repository root, generated app roots, ignored secrets, client configuration, and final Git status. Hand off application work to the generated `AGENTS.md` and relevant skills.
