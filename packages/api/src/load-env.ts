import path from "path";
import { config } from "dotenv";

// Local development only. The repo-root .env is gitignored and holds secrets
// such as MINIMAX_API_KEY; Railway injects real environment variables instead
// and has no .env, which dotenv treats as a non-fatal miss.
//
// The path is explicit because `pnpm --filter api dev` runs with packages/api
// as its working directory, so dotenv's default cwd lookup would miss the root
// file. __dirname sits at packages/api/{src,dist} under both ts-node-dev and
// the compiled build, so the same three levels reach the repo root either way.
//
// This module exists as a separate import purely for ordering: ES import
// bindings are evaluated before any statement in the importing file, so calling
// config() at the top of index.ts would still run after every other module had
// been initialised. Importing this first guarantees the variables are present
// before anything reads process.env.
// quiet suppresses dotenv's startup banner, which would otherwise print on
// every boot into the Railway logs where no .env exists to report on anyway.
config({ path: path.resolve(__dirname, "../../../.env"), quiet: true });
