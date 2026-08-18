// eslint-config-next 16 ships native flat configs, so they are imported
// directly. The previous FlatCompat.extends("next/...") indirection pushed a
// flat-config array through the legacy eslintrc loader, which blew up with
// "Converting circular structure to JSON" and left `pnpm lint` non-functional.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "_agg_venv/**",
    ],
  },
  ...coreWebVitals,
  ...typescript,
];

export default eslintConfig;
