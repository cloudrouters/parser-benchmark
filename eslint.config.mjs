import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // `oldcode/` is a reference-only copy of the previous project.
    ignores: ["node_modules/", "dist/", "build/", "coverage/", "oldcode/"],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Plain JS configs are not part of tsconfig, so type-aware rules are disabled for them.
    files: ["**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
