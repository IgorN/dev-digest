/**
 * Composition root for `devdigest review --mode working` — a SECOND,
 * independent transport onto this package's ports (the MCP stdio server in
 * `../main.ts` is the first). Wires infra (git, HTTP client, LLM provider,
 * env config) -> ports -> the `review-working-tree` use-case -> plain stdout,
 * so a developer gets the SAME structured review the product runs on GitHub
 * PRs, from their own working copy, before anything is pushed.
 *
 * Unlike `../main.ts`, stdout here is normal CLI output (not a JSON-RPC
 * transport), so `console.log`/`console.error` are used per Unix convention:
 * result on stdout, diagnostics/errors on stderr.
 */
import { loadConfig } from '../infra/config.js';
import { HttpDevDigestApi } from '../infra/http-client.js';
import { LocalGitClient } from '../infra/git.js';
import { buildLlmProvider, MissingApiKeyError } from '../infra/llm.js';
import { GitUnavailableError } from '../ports/git.js';
import { makeReviewWorkingTreeUseCase } from '../app/review-working-tree.usecase.js';
import { formatReviewForTerminal } from '../domain/format-review.js';
import { parseCliArgs } from '../domain/cli-args.js';
import { isMcpToolError } from '../domain/errors.js';
import { UpstreamHttpError } from '../ports/devdigest-api.js';

async function main(): Promise<number> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    return 1;
  }

  const config = loadConfig();
  const reviewWorkingTree = makeReviewWorkingTreeUseCase({
    git: new LocalGitClient(),
    api: new HttpDevDigestApi(config.apiBaseUrl),
    buildLlm: buildLlmProvider,
  });

  try {
    const result = await reviewWorkingTree({ cwd: process.cwd() });

    if (result.noChanges) {
      console.log('No changes in the working tree to review.');
      return 0;
    }

    console.log(
      formatReviewForTerminal(result.outcome, {
        agentName: result.agentName,
        model: result.model,
        filesChanged: result.filesChanged,
      }),
    );
    return 0;
  } catch (err) {
    if (err instanceof GitUnavailableError || err instanceof MissingApiKeyError) {
      console.error(err.message);
      return 2;
    }
    if (isMcpToolError(err)) {
      console.error(err.message);
      return 2;
    }
    if (err instanceof UpstreamHttpError) {
      console.error(
        `Could not reach the DevDigest API at ${config.apiBaseUrl} (${err.message}). ` +
          'Is the server running? (server/CLAUDE.md: `cd server && pnpm dev`)',
      );
      return 2;
    }
    // The LLM call itself failed (bad key, rate limit, network) — the
    // provider's own error message is already actionable; no need for a
    // raw stack trace in a CLI's stderr.
    if (err instanceof Error) {
      console.error(`devdigest review: LLM call failed — ${err.message}`);
      return 2;
    }
    throw err;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('devdigest review: unexpected error', err);
    process.exit(2);
  });
